import "server-only";

import type { Order, PrepStatus, PrepTask } from "@/lib/storage/types";
import { RESTAURANT_ID, adminDb } from "@/lib/server/firebaseAdmin";
import {
  HttpError,
  authorizeRestaurantStaff,
  type RestaurantCaller,
} from "@/lib/server/auth";
import { prepTaskTransitionDecision } from "@/lib/orderLifecycle";

const NEXT_STATUS: Record<PrepStatus, PrepStatus | null> = {
  todo: "prepping",
  prepping: "ready",
  ready: "done",
  done: null,
};

const STATUSES = Object.keys(NEXT_STATUS) as PrepStatus[];

export interface PrepStatusInput {
  taskId?: unknown;
  status?: unknown;
}

export interface PrepStatusResult {
  taskId: string;
  status: PrepStatus;
  unchanged?: boolean;
}

/**
 * Advances one kitchen task atomically.
 *
 * The request carries only intent. Identity, timestamps and completion audit
 * fields come from this trusted boundary, never from browser-supplied data.
 */
export async function setPrepTaskStatus(
  caller: RestaurantCaller,
  input: PrepStatusInput
): Promise<PrepStatusResult> {
  const { taskId, status } = input;
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new HttpError(400, "Which prep task?");
  }
  if (!STATUSES.includes(status as PrepStatus)) {
    throw new HttpError(400, "That prep status is not valid.");
  }

  const requested = status as PrepStatus;
  const db = adminDb();
  const ref = db.doc(`restaurants/${RESTAURANT_ID}/prepTasks/${taskId}`);

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new HttpError(404, "That prep task does not exist.");

    const task = snap.data() as PrepTask;
    // Do not rely on the collection path alone: a corrupt or copied resource
    // must not become manageable by staff from the wrong tenant.
    if (task.restaurantId !== RESTAURANT_ID) {
      throw new HttpError(403, "You cannot manage tasks for this restaurant.");
    }
    if (!authorizeRestaurantStaff(caller, task.restaurantId, RESTAURANT_ID)) {
      throw new HttpError(403, "Restaurant staff only.");
    }

    const orderRef = db.doc(`restaurants/${RESTAURANT_ID}/orders/${task.orderId}`);
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) throw new HttpError(409, "This task's order no longer exists.");
    const order = orderSnap.data() as Order;

    // A retry after a lost response (and two identical concurrent clicks) is
    // harmless. It must not rewrite the original completion audit trail.
    if (task.status === requested) {
      return { taskId, status: requested, unchanged: true };
    }
    const decision = prepTaskTransitionDecision(order.status, task.status, requested);
    if (!STATUSES.includes(task.status) || !decision.allowed) {
      throw new HttpError(409, decision.reason ?? "That prep task transition is not permitted.");
    }

    const at = new Date().toISOString();
    transaction.update(ref, {
      status: requested,
      updatedAt: at,
      ...(requested === "done" ? { doneAt: at, doneByUid: caller.uid } : {}),
    });
    return { taskId, status: requested };
  });
}
