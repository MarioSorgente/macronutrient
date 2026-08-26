import "server-only";

import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { RESTAURANT_ID, adminDb } from "@/lib/server/firebaseAdmin";
import { HttpError } from "@/lib/server/auth";
import {
  validateOrderDays,
  validatePlanForOrder,
  validatePlanSchedule,
} from "@/lib/server/planValidation";
import { cutoffState } from "@/lib/cutoff";
import { byId } from "@/lib/clients";
import { planWithMenuIdentity } from "@/lib/menuIdentity";
import {
  buildOrderDays,
  fulfilmentProblems,
  prepTasksFor,
  summarizeOrder,
  weekStartDate,
  type FulfilmentByDay,
} from "@/lib/orders";
import {
  DEFAULT_RESTAURANT_CONFIG,
  LIVE_ORDER_STATUSES,
  type Dish,
  type Fulfilment,
  type Order,
  type OrderStatus,
  type RestaurantConfig,
} from "@/lib/storage/types";

/**
 * Turning a planned week into a prep order the kitchen is committed to.
 *
 * Three things must not be client-controlled: the price, the deadline, and the
 * fact that an order exists at all. The security rules deny writes to `orders`
 * outright, so this is the only path — and it rebuilds the order from the plan
 * it reads itself rather than trusting anything in the request.
 *
 * The same `calc`, `pricing` and `orders` modules the browser uses are
 * imported here, so both sides agree on what an order *means* without keeping
 * two copies of the rules.
 */

const MIN_RESUBMIT_MS = 60_000;

interface LiveOrderReservation {
  orderId: string;
  userId: string;
  planId: string;
  weekNumber: number;
  createdAt: string;
}

/** A bounded Firestore-safe identity for the one live order a week may have. */
function reservationId(userId: string, planId: string, weekNumber: number): string {
  return createHash("sha256")
    .update(JSON.stringify([RESTAURANT_ID, userId, planId, weekNumber]))
    .digest("hex");
}

function reservationRef(db: Firestore, userId: string, planId: string, weekNumber: number) {
  return db.doc(
    `restaurants/${RESTAURANT_ID}/liveOrderReservations/` +
      reservationId(userId, planId, weekNumber)
  );
}

/** Statuses that mean the kitchen has no work left to do. */
const DEAD: OrderStatus[] = ["cancelled", "rejected"];

/** Every status an order may be moved to. Anything else is a bad request. */
const ORDER_STATUSES: OrderStatus[] = [
  "submitted",
  "accepted",
  "in_prep",
  "ready",
  "completed",
  "rejected",
  "cancelled",
];

function isValidTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Rejects anything that is not a well-formed choice before it reaches the plan. */
export function readFulfilment(raw: unknown): FulfilmentByDay {
  const out: FulfilmentByDay = {};
  if (!raw || typeof raw !== "object") return out;

  for (const [key, value] of Object.entries(raw as Record<string, Fulfilment>)) {
    const day = Number(key);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    if (!value || (value.mode !== "pickup" && value.mode !== "delivery")) continue;
    if (!isValidTime(value.time)) continue;

    out[day] = {
      mode: value.mode,
      time: value.time,
      ...(typeof value.address === "string" && value.address.trim()
        ? { address: value.address.trim().slice(0, 300) }
        : {}),
      ...(typeof value.note === "string" && value.note.trim()
        ? { note: value.note.trim().slice(0, 300) }
        : {}),
    };
  }
  return out;
}

async function loadConfig(db: Firestore): Promise<RestaurantConfig> {
  const snap = await db.doc(`restaurants/${RESTAURANT_ID}`).get();
  const stored = snap.exists ? (snap.data() as Partial<RestaurantConfig>) : {};
  const now = new Date().toISOString();
  return {
    id: RESTAURANT_ID,
    createdAt: stored.createdAt ?? now,
    updatedAt: stored.updatedAt ?? now,
    ...DEFAULT_RESTAURANT_CONFIG,
    ...stored,
  } as RestaurantConfig;
}

export interface SubmitInput {
  planId?: unknown;
  weekNumber?: unknown;
  fulfilment?: unknown;
}

export interface SubmitResult {
  orderId: string;
  mealCount?: number;
  priceIdr?: number;
  deduplicated?: boolean;
}

/** Contact details taken from the verified ID token rather than from a document. */
export interface VerifiedIdentity {
  email?: string;
  name?: string;
}

export async function submitOrder(
  uid: string,
  input: SubmitInput,
  verified: VerifiedIdentity = {}
): Promise<SubmitResult> {
  const db = adminDb();

  const { planId, weekNumber } = input;
  if (!planId || typeof planId !== "string") {
    throw new HttpError(400, "Which plan?");
  }
  if (!Number.isInteger(weekNumber) || (weekNumber as number) < 1) {
    throw new HttpError(400, "Which week?");
  }
  const week = weekNumber as number;

  const config = await loadConfig(db);
  if (!config.acceptingOrders) {
    throw new HttpError(409, "Negrita is not taking orders at the moment.");
  }

  const dishesSnap = await db.collection(`users/${uid}/dishes`).get();
  const dishes = byId(dishesSnap.docs.map((d) => d.data() as Dish));
  const profile = (await db.doc(`users/${uid}`).get()).data() ?? {};
  const orderRef = db.collection(`restaurants/${RESTAURANT_ID}/orders`).doc();
  const lockRef = reservationRef(db, uid, planId, week);
  const planRef = db.doc(`users/${uid}/plans/${planId}`);

  return db.runTransaction(async (transaction) => {
    // This deterministic document is the contention point. Firestore retries
    // one of two concurrent transactions after the other creates it.
    const lockSnap = await transaction.get(lockRef);
    if (lockSnap.exists) {
      const reservation = lockSnap.data() as LiveOrderReservation;
      const previous = await transaction.get(
        db.doc(`restaurants/${RESTAURANT_ID}/orders/${reservation.orderId}`)
      );
      if (previous.exists && LIVE_ORDER_STATUSES.includes((previous.data() as Order).status)) {
        const submittedAt = Date.parse((previous.data() as Order).submittedAt ?? "");
        if (Number.isFinite(submittedAt) && Date.now() - submittedAt < MIN_RESUBMIT_MS) {
          return { orderId: previous.id, deduplicated: true };
        }
        throw new HttpError(409, "That week has already been sent to the kitchen.");
      }
      // Dead transitions remove their reservation transactionally. Reaching
      // this state means storage was modified outside this lifecycle.
      throw new HttpError(409, "That week already has an order reservation.");
    }

    // Read the plan in the same transaction that reserves and writes it, so an
    // order cannot be based on a different plan revision than submittedWeeks.
    const planSnap = await transaction.get(planRef);
    if (!planSnap.exists) throw new HttpError(404, "That plan does not exist.");
    const plan = planSnap.data();
    // These bounds guard every date/week calculation below, independently of
    // the more extensive plan integrity validation that follows.
    validatePlanSchedule(plan, week);
    validatePlanForOrder(plan, week, dishes);
    const startDate = weekStartDate(plan, week);
    const { at: cutoff, passed } = cutoffState(startDate, {
      timezone: config.timezone,
      cutoffDay: config.cutoffDay,
      cutoffTime: config.cutoffTime,
    }, new Date());
    if (passed) throw new HttpError(409, "Orders for that week have closed.");

    const days = buildOrderDays(
      planWithMenuIdentity(plan, dishes), week, dishes, readFulfilment(input.fulfilment)
    );
    validateOrderDays(days);
    if (days.length === 0) throw new HttpError(409, "That week has no meals in it.");
    const problems = fulfilmentProblems(days);
    if (problems.length > 0) throw new HttpError(400, problems.join(" "));
    const summary = summarizeOrder(days);
    if (!Number.isFinite(summary.priceIdr) || summary.priceIdr < 0 ||
        Object.values(summary.totals).some((value) => !Number.isFinite(value) || value < 0)) {
      throw new HttpError(400, "Invalid plan: derived order totals are invalid.");
    }
    const now = new Date().toISOString();
    const order: Order = {
      id: orderRef.id,
      createdAt: now,
      updatedAt: now,
      restaurantId: RESTAURANT_ID,
      userId: uid,
      planId,
      weekNumber: week,
      weekStartDate: startDate,
      status: "submitted",
      customer: {
        // A name is the account holder's to choose, so the profile wins and the
        // token is the fallback. An email is an identity the kitchen may act on,
        // so it comes from the verified token and never from a document the
        // account holder can write. A phone is theirs to give, but bounded.
        name: String(profile.displayName ?? verified.name ?? "Guest").slice(0, 120),
        email: String(verified.email ?? profile.email ?? ""),
        ...(profile.phone ? { phone: String(profile.phone).slice(0, 40) } : {}),
      },
      days,
      totals: summary.totals,
      priceIdr: summary.priceIdr,
      mealCount: summary.mealCount,
      payment: { status: "unpaid", method: "cash", amountIdr: summary.priceIdr },
      submittedAt: now,
      lockedAt: cutoff.toISOString(),
      statusHistory: [{ status: "submitted", at: now, byUid: uid }],
    };

    const tasks = prepTasksFor(
      order,
      (orderId, date, assignmentId) => `${orderId}_${date}_${assignmentId}`
    );

    transaction.create(lockRef, {
      orderId: orderRef.id, userId: uid, planId, weekNumber: week, createdAt: now,
    } satisfies LiveOrderReservation);
    transaction.create(orderRef, order);
    for (const task of tasks) {
      transaction.create(db.doc(`restaurants/${RESTAURANT_ID}/prepTasks/${task.id}`), task);
    }
    transaction.update(planRef, {
      status: "submitted",
      submittedWeeks: Array.from(new Set([...(plan.submittedWeeks ?? []), week])),
      updatedAt: now,
    });

    return { orderId: orderRef.id, mealCount: summary.mealCount, priceIdr: summary.priceIdr };
  });
}

/**
 * Moves an order through its lifecycle, and keeps the kitchen board in step.
 *
 * The cascade below used to be a Firestore trigger. Doing it here instead is
 * explicit rather than ambient, and it happens in the same request as the
 * status change, so there is no window where an order is cancelled but the
 * kitchen is still cooking it.
 *
 * A customer may only cancel their own week, and only before the kitchen has
 * accepted it — the same rule the security rules enforce for direct writes.
 */
export async function setOrderStatus(
  caller: { uid: string; role?: string },
  orderId: unknown,
  status: unknown,
  note?: unknown
): Promise<{ orderId: string; status: OrderStatus }> {
  if (typeof orderId !== "string" || !orderId) {
    throw new HttpError(400, "Which order?");
  }
  if (!ORDER_STATUSES.includes(status as OrderStatus)) {
    throw new HttpError(400, "That is not a valid order status.");
  }
  const next = status as OrderStatus;
  const db = adminDb();

  const ref = db.doc(`restaurants/${RESTAURANT_ID}/orders/${orderId}`);
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new HttpError(404, "That order does not exist.");
    const order = snap.data() as Order;

    const isStaff = caller.role === "admin" || caller.role === "restaurant";
    if (!isStaff) {
      if (order.userId !== caller.uid) throw new HttpError(404, "That order does not exist.");
      if (next !== "cancelled") throw new HttpError(403, "You can only cancel your own week.");
      if (order.status !== "submitted") {
        throw new HttpError(
          409,
          "The kitchen has already started this week, so it can no longer be cancelled."
        );
      }
    }

    const becomingDead = DEAD.includes(next) && !DEAD.includes(order.status);
    const lockRef = reservationRef(db, order.userId, order.planId, order.weekNumber);
    const planRef = db.doc(`users/${order.userId}/plans/${order.planId}`);
    const [tasks, plan, lock] = becomingDead
      ? await Promise.all([
          transaction.get(
            db.collection(`restaurants/${RESTAURANT_ID}/prepTasks`)
              .where("orderId", "==", orderId)
          ),
          transaction.get(planRef),
          transaction.get(lockRef),
        ])
      : [null, null, null];

    const now = new Date().toISOString();
    // The note is shown to the diner as "From Negrita", so only Negrita may
    // write it, and it is bounded like every other stored free text.
    const restaurantNote = isStaff && typeof note === "string"
      ? note.trim().slice(0, 500)
      : null;
    transaction.update(ref, {
      status: next,
      updatedAt: now,
      ...(restaurantNote ? { restaurantNote } : {}),
      statusHistory: [
        ...(order.statusHistory ?? []),
        { status: next, at: now, byUid: caller.uid },
      ],
    });

    if (becomingDead) {
      for (const task of tasks!.docs) transaction.delete(task.ref);
      if (plan!.exists) {
        const submitted: number[] = plan!.data()?.submittedWeeks ?? [];
        transaction.update(planRef, {
          submittedWeeks: submitted.filter((w) => w !== order.weekNumber),
          updatedAt: now,
        });
      }
      // Only remove this order's lock: this protects against repairing a stale
      // reservation while a newer live order owns the same week.
      if (lock!.exists && (lock!.data() as LiveOrderReservation).orderId === orderId) {
        transaction.delete(lockRef);
      }
    }
  });
  return { orderId, status: next };
}
