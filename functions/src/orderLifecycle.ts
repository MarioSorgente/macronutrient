import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { REGION } from "./config";
import type { Order } from "@/lib/storage/types";

/**
 * Keeps the kitchen board in step with the order book.
 *
 * A cancelled or rejected order must stop being work. Neither side can do this
 * itself: a customer is not allowed to write prep tasks at all, and asking the
 * restaurant to remember to clear them by hand is exactly the kind of step that
 * gets skipped on a busy service — leaving the kitchen cooking food nobody is
 * coming to collect.
 *
 * A trigger rather than logic in the callers, because there are several ways an
 * order can die (the customer cancels, the restaurant rejects, an admin
 * intervenes) and they should not each carry their own copy of the cleanup.
 */
const DEAD: Order["status"][] = ["cancelled", "rejected"];

export const onOrderStatusChanged = onDocumentUpdated(
  { document: "restaurants/{rid}/orders/{orderId}", region: REGION },
  async (event) => {
    const before = event.data?.before.data() as Order | undefined;
    const after = event.data?.after.data() as Order | undefined;
    if (!before || !after || before.status === after.status) return;
    if (!DEAD.includes(after.status)) return;

    const { rid, orderId } = event.params;
    const db = getFirestore();

    const tasks = await db
      .collection(`restaurants/${rid}/prepTasks`)
      .where("orderId", "==", orderId)
      .get();
    if (tasks.empty) return;

    const batch = db.batch();
    for (const task of tasks.docs) batch.delete(task.ref);

    // Free the week so the customer can fix and resend it, rather than being
    // stuck behind an order that no longer exists.
    const planRef = db.doc(`users/${after.userId}/plans/${after.planId}`);
    const plan = await planRef.get();
    if (plan.exists) {
      const submitted: number[] = plan.data()?.submittedWeeks ?? [];
      batch.update(planRef, {
        submittedWeeks: submitted.filter((w) => w !== after.weekNumber),
        updatedAt: new Date().toISOString(),
      });
    }

    await batch.commit();
  }
);
