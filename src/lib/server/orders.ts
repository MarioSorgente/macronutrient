import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { RESTAURANT_ID, adminDb } from "@/lib/server/firebaseAdmin";
import { HttpError } from "@/lib/server/auth";
import { cutoffState } from "@/lib/cutoff";
import { byId } from "@/lib/clients";
import { withMenuIdentity } from "@/lib/menuIdentity";
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
  type Plan,
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

export async function submitOrder(
  uid: string,
  input: SubmitInput
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

  // Read the plan ourselves. Nothing about the order is taken from the caller
  // except which week it is and how they want it delivered.
  const planSnap = await db.doc(`users/${uid}/plans/${planId}`).get();
  if (!planSnap.exists) throw new HttpError(404, "That plan does not exist.");
  const stored = planSnap.data() as Plan;
  // The browser gives a plan its menu identity when it loads one; this read has
  // to do the same, or a week planned before that existed would be quoted to
  // the diner at menu prices and billed to the kitchen at ingredient prices.
  // Both sides run the same order rules, so both sides start from the same plan.
  const plan: Plan = {
    ...stored,
    assignments: (stored.assignments ?? []).map(withMenuIdentity),
  };

  const startDate = weekStartDate(plan, week);
  const { at: cutoff, passed } = cutoffState(
    startDate,
    {
      timezone: config.timezone,
      cutoffDay: config.cutoffDay,
      cutoffTime: config.cutoffTime,
    },
    new Date()
  );
  if (passed) throw new HttpError(409, "Orders for that week have closed.");

  // Only a LIVE order blocks a resend. A cancelled or rejected one has already
  // had its prep tasks cleared and its week freed, so counting it here would
  // leave a week the UI says is editable but that can never be sent again.
  const existing = await db
    .collection(`restaurants/${RESTAURANT_ID}/orders`)
    .where("userId", "==", uid)
    .where("planId", "==", planId)
    .where("weekNumber", "==", week)
    .get();

  const previous = existing.docs.find((doc) =>
    LIVE_ORDER_STATUSES.includes((doc.data() as Order).status)
  );
  if (previous) {
    const submittedAt = Date.parse((previous.data() as Order).submittedAt ?? "");
    // A repeated submit within a minute is a double click, not a second order.
    if (Number.isFinite(submittedAt) && Date.now() - submittedAt < MIN_RESUBMIT_MS) {
      return { orderId: previous.id, deduplicated: true };
    }
    throw new HttpError(409, "That week has already been sent to the kitchen.");
  }

  const dishesSnap = await db.collection(`users/${uid}/dishes`).get();
  const dishes = byId(dishesSnap.docs.map((d) => d.data() as Dish));

  const days = buildOrderDays(plan, week, dishes, readFulfilment(input.fulfilment));
  if (days.length === 0) throw new HttpError(409, "That week has no meals in it.");

  const problems = fulfilmentProblems(days);
  if (problems.length > 0) throw new HttpError(400, problems.join(" "));

  const summary = summarizeOrder(days);
  const profile = (await db.doc(`users/${uid}`).get()).data() ?? {};
  const now = new Date().toISOString();
  const orderRef = db.collection(`restaurants/${RESTAURANT_ID}/orders`).doc();

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
      name: String(profile.displayName ?? "Guest"),
      email: String(profile.email ?? ""),
      ...(profile.phone ? { phone: String(profile.phone) } : {}),
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

  // One batch: an order without its prep tasks would be invisible to the
  // kitchen, and prep tasks without an order would have nothing to cancel.
  const batch = db.batch();
  batch.set(orderRef, order);
  for (const task of tasks) {
    batch.set(db.doc(`restaurants/${RESTAURANT_ID}/prepTasks/${task.id}`), task);
  }
  batch.update(planSnap.ref, {
    status: "submitted",
    submittedWeeks: Array.from(new Set([...(plan.submittedWeeks ?? []), week])),
    updatedAt: now,
  });
  await batch.commit();

  return {
    orderId: orderRef.id,
    mealCount: summary.mealCount,
    priceIdr: summary.priceIdr,
  };
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
  const snap = await ref.get();
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

  const now = new Date().toISOString();
  const batch = db.batch();
  batch.update(ref, {
    status: next,
    updatedAt: now,
    ...(typeof note === "string" ? { restaurantNote: note } : {}),
    statusHistory: [
      ...(order.statusHistory ?? []),
      { status: next, at: now, byUid: caller.uid },
    ],
  });

  if (DEAD.includes(next) && !DEAD.includes(order.status)) {
    // A dead order must stop being work. Neither side can do this itself: a
    // customer may not write prep tasks at all, and leaving it to the
    // restaurant is exactly the step that gets skipped on a busy service.
    const tasks = await db
      .collection(`restaurants/${RESTAURANT_ID}/prepTasks`)
      .where("orderId", "==", orderId)
      .get();
    for (const task of tasks.docs) batch.delete(task.ref);

    // Free the week so the customer can fix and resend it.
    const planRef = db.doc(`users/${order.userId}/plans/${order.planId}`);
    const plan = await planRef.get();
    if (plan.exists) {
      const submitted: number[] = plan.data()?.submittedWeeks ?? [];
      batch.update(planRef, {
        submittedWeeks: submitted.filter((w) => w !== order.weekNumber),
        updatedAt: now,
      });
    }
  }

  await batch.commit();
  return { orderId, status: next };
}
