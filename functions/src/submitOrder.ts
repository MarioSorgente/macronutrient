import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { REGION, RESTAURANT_ID, RESTAURANT_TIMEZONE } from "./config";

import { cutoffState } from "@/lib/cutoff";
import { byId } from "@/lib/clients";
import {
  buildOrderDays,
  fulfilmentProblems,
  prepTasksFor,
  summarizeOrder,
  weekStartDate,
  type FulfilmentByDay,
} from "@/lib/orders";
import type {
  Dish,
  Fulfilment,
  Order,
  Plan,
  RestaurantConfig,
} from "@/lib/storage/types";
import { DEFAULT_RESTAURANT_CONFIG } from "@/lib/storage/types";

/**
 * Turns a planned week into a prep order the kitchen is committed to.
 *
 * The point of doing this on the server is that three things must not be
 * client-controlled: the price, the deadline, and the fact that an order
 * exists at all. The rules deny writes to `orders` outright, so this function
 * is the only way one is created — and it rebuilds the order from the plan it
 * reads itself rather than trusting anything in the request.
 */

const MIN_RESUBMIT_MS = 60_000;

interface SubmitRequest {
  planId?: string;
  weekNumber?: number;
  fulfilment?: Record<string, Fulfilment>;
}

function isValidTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Rejects anything that is not a well-formed choice before it reaches the plan. */
function readFulfilment(raw: SubmitRequest["fulfilment"]): FulfilmentByDay {
  const out: FulfilmentByDay = {};
  if (!raw || typeof raw !== "object") return out;

  for (const [key, value] of Object.entries(raw)) {
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

async function loadConfig(db: FirebaseFirestore.Firestore): Promise<RestaurantConfig> {
  const snap = await db.doc(`restaurants/${RESTAURANT_ID}`).get();
  const stored = snap.exists ? (snap.data() as Partial<RestaurantConfig>) : {};
  const now = new Date().toISOString();
  return {
    id: RESTAURANT_ID,
    createdAt: stored.createdAt ?? now,
    updatedAt: stored.updatedAt ?? now,
    ...DEFAULT_RESTAURANT_CONFIG,
    timezone: RESTAURANT_TIMEZONE,
    ...stored,
  } as RestaurantConfig;
}

export const submitOrder = onCall({ region: REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to send a week to the kitchen.");
  }
  const uid = request.auth.uid;
  const db = getFirestore();

  const { planId, weekNumber } = (request.data ?? {}) as SubmitRequest;
  if (!planId || typeof planId !== "string") {
    throw new HttpsError("invalid-argument", "Which plan?");
  }
  if (!Number.isInteger(weekNumber) || (weekNumber as number) < 1) {
    throw new HttpsError("invalid-argument", "Which week?");
  }
  const week = weekNumber as number;

  const config = await loadConfig(db);
  if (!config.acceptingOrders) {
    throw new HttpsError(
      "failed-precondition",
      "Negrita is not taking orders at the moment."
    );
  }

  // Read the plan ourselves. Nothing about the order is taken from the caller
  // except which week it is and how they want it delivered.
  const planSnap = await db.doc(`users/${uid}/plans/${planId}`).get();
  if (!planSnap.exists) {
    throw new HttpsError("not-found", "That plan does not exist.");
  }
  const plan = planSnap.data() as Plan;

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
  if (passed) {
    throw new HttpsError(
      "failed-precondition",
      "Orders for that week have closed."
    );
  }

  // A repeated submit within a minute is a double click, not a second order.
  const existing = await db
    .collection(`restaurants/${RESTAURANT_ID}/orders`)
    .where("userId", "==", uid)
    .where("planId", "==", planId)
    .where("weekNumber", "==", week)
    .limit(1)
    .get();

  const previous = existing.docs[0];
  if (previous) {
    const submittedAt = Date.parse(
      (previous.data() as Order).submittedAt ?? ""
    );
    if (Number.isFinite(submittedAt) && Date.now() - submittedAt < MIN_RESUBMIT_MS) {
      return { orderId: previous.id, deduplicated: true };
    }
    throw new HttpsError(
      "already-exists",
      "That week has already been sent to the kitchen."
    );
  }

  const dishesSnap = await db.collection(`users/${uid}/dishes`).get();
  const dishes = byId(dishesSnap.docs.map((d) => d.data() as Dish));

  // Rebuilt from the plan, with the app's own pricing and macro code.
  const days = buildOrderDays(plan, week, dishes, readFulfilment(request.data?.fulfilment));
  if (days.length === 0) {
    throw new HttpsError("failed-precondition", "That week has no meals in it.");
  }

  const problems = fulfilmentProblems(days);
  if (problems.length > 0) {
    throw new HttpsError("invalid-argument", problems.join(" "));
  }

  const summary = summarizeOrder(days);
  const profile = await db.doc(`users/${uid}`).get();
  const person = profile.data() ?? {};
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
      name: String(person.displayName ?? request.auth.token.name ?? "Guest"),
      email: String(person.email ?? request.auth.token.email ?? ""),
      ...(person.phone ? { phone: String(person.phone) } : {}),
    },
    days,
    totals: summary.totals,
    priceIdr: summary.priceIdr,
    mealCount: summary.mealCount,
    payment: {
      status: "unpaid",
      method: "cash",
      amountIdr: summary.priceIdr,
    },
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

  return { orderId: orderRef.id, mealCount: summary.mealCount, priceIdr: summary.priceIdr };
});
