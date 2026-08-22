import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  RESTAURANT_ID,
  adminGet,
  adminList,
  adminSet,
  clearAuth,
  clearFirestore,
  createHarness,
  waitFor,
  type Harness,
} from "./appHarness";

/**
 * onOrderStatusChanged — the trigger that keeps the kitchen board in step with
 * the order book.
 *
 * A cancelled or rejected order must stop being work. Neither side can do this
 * itself: a customer may not write prep tasks at all, and leaving it to the
 * restaurant to clear them by hand is exactly the step that gets skipped on a
 * busy service, so the kitchen keeps cooking food nobody is collecting.
 */

const CHICKEN = "chicken_breast_raw";
let h: Harness;
let seq = 0;

function mondayAhead(weeks: number): string {
  const now = new Date();
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dow = (new Date(utcMidnight).getUTCDay() + 6) % 7;
  return new Date(utcMidnight - dow * 86_400_000 + weeks * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Submits a real week, so the order and its prep tasks are genuine. */
async function submitAWeek() {
  const user = await h.signUp(`diner${(seq += 1)}-${Date.now()}@example.com`, "password123");
  const uid = user.uid;

  await adminSet(`users/${uid}/plans/p1`, {
    id: "p1", ownerUid: uid, title: "My week", targets: null,
    mealSlots: ["Lunch"], programStartDate: mondayAhead(3), weekCount: 2,
    assignments: [
      {
        id: "a1", week: 1, day: 0, slot: "Lunch", servings: 1,
        items: [{ ingredientId: CHICKEN, name: "Chicken", grams: 150, unitId: "g", quantity: 150 }],
        snapshot: { name: "Chicken plate", totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 } },
      },
      {
        id: "a2", week: 1, day: 1, slot: "Lunch", servings: 1,
        items: [{ ingredientId: CHICKEN, name: "Chicken", grams: 150, unitId: "g", quantity: 150 }],
        snapshot: { name: "Chicken plate", totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 } },
      },
    ],
    status: "draft", submittedWeeks: [],
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
  });

  const { orderId } = await h.call<unknown, { orderId: string }>("submitOrder", {
    planId: "p1", weekNumber: 1,
    fulfilment: { 0: { mode: "pickup", time: "12:00" }, 1: { mode: "pickup", time: "12:00" } },
  });
  return { uid, orderId };
}

beforeAll(() => { h = createHarness(); });

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
  await adminSet(`restaurants/${RESTAURANT_ID}`, {
    id: RESTAURANT_ID, name: "Negrita", timezone: "Asia/Makassar",
    cutoffDay: 6, cutoffTime: "18:00", acceptingOrders: true, markupPct: 0,
    createdAt: "", updatedAt: "",
  });
});

afterAll(async () => { await h?.dispose(); });

describe("a dead order stops being work", () => {
  it.each(["cancelled", "rejected"])(
    "clears every prep task when an order becomes %s",
    async (status) => {
      const { orderId } = await submitAWeek();
      expect(await adminList(`restaurants/${RESTAURANT_ID}/prepTasks`)).toHaveLength(2);

      await adminSet(
        `restaurants/${RESTAURANT_ID}/orders/${orderId}`,
        { status },
        { merge: true }
      );

      const cleared = await waitFor(
        async () =>
          (await adminList(`restaurants/${RESTAURANT_ID}/prepTasks`)).length === 0,
        { label: `prep tasks cleared after ${status}` }
      );
      expect(cleared).toBe(true);
    }
  );

  it("frees the week so the customer can fix and resend it", async () => {
    const { uid, orderId } = await submitAWeek();
    expect((await adminGet(`users/${uid}/plans/p1`))?.submittedWeeks).toEqual([1]);

    await adminSet(
      `restaurants/${RESTAURANT_ID}/orders/${orderId}`,
      { status: "cancelled" },
      { merge: true }
    );

    await waitFor(
      async () => {
        const plan = await adminGet(`users/${uid}/plans/p1`);
        return Array.isArray(plan?.submittedWeeks) && plan.submittedWeeks.length === 0;
      },
      { label: "week freed on the plan" }
    );
  });

  /**
   * Regression: onOrderStatusChanged frees the week on the plan so it can be
   * fixed and resent, but submitOrder's duplicate check had no status filter,
   * so it still found the cancelled order and rejected every resend with
   * "That week has already been sent to the kitchen." The week became
   * permanently un-orderable while the UI showed it as editable.
   */
  it("lets the customer resubmit the week afterwards", async () => {
    const { orderId } = await submitAWeek();
    await adminSet(
      `restaurants/${RESTAURANT_ID}/orders/${orderId}`,
      { status: "cancelled" },
      { merge: true }
    );
    await waitFor(
      async () =>
        (await adminList(`restaurants/${RESTAURANT_ID}/prepTasks`)).length === 0,
      { label: "prep tasks cleared" }
    );

    // Age the cancelled order past the dedup window, so this is a genuine
    // resend rather than a double click.
    await adminSet(
      `restaurants/${RESTAURANT_ID}/orders/${orderId}`,
      { submittedAt: new Date(Date.now() - 5 * 60_000).toISOString() },
      { merge: true }
    );

    const resent = await h.call<unknown, { orderId: string; mealCount: number }>(
      "submitOrder",
      {
        planId: "p1", weekNumber: 1,
        fulfilment: { 0: { mode: "pickup", time: "12:00" }, 1: { mode: "pickup", time: "12:00" } },
      }
    );

    expect(resent.orderId).not.toBe(orderId); // a new order, not the dead one
    expect(resent.mealCount).toBe(2);

    // And the kitchen gets its board back.
    await waitFor(
      async () =>
        (await adminList(`restaurants/${RESTAURANT_ID}/prepTasks`)).length === 2,
      { label: "prep tasks recreated for the resent week" }
    );
  });

  it("still blocks a second submit while the first order is live", async () => {
    // The dedup fix must not become a licence to double-order.
    const { orderId } = await submitAWeek();
    await adminSet(
      `restaurants/${RESTAURANT_ID}/orders/${orderId}`,
      { submittedAt: new Date(Date.now() - 5 * 60_000).toISOString() },
      { merge: true }
    );
    await expect(
      h.call("submitOrder", {
        planId: "p1", weekNumber: 1,
        fulfilment: { 0: { mode: "pickup", time: "12:00" }, 1: { mode: "pickup", time: "12:00" } },
      })
    ).rejects.toThrow(/already/i);
  });
});

describe("a live status change is not a cancellation", () => {
  it("leaves the board alone when an order is accepted", async () => {
    const { orderId } = await submitAWeek();
    await adminSet(
      `restaurants/${RESTAURANT_ID}/orders/${orderId}`,
      { status: "accepted" },
      { merge: true }
    );
    // Give the trigger the same chance it gets above before asserting nothing
    // happened.
    await new Promise((r) => setTimeout(r, 3_000));
    expect(await adminList(`restaurants/${RESTAURANT_ID}/prepTasks`)).toHaveLength(2);
  });
});
