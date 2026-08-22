import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
 * The submitOrder Cloud Function, called the way the browser calls it.
 *
 * Three things are deliberately server-side, and each gets a test: the price
 * (recomputed from the plan the server reads itself), the cutoff (enforced in
 * Bali time), and the fact that an order exists at all (the rules deny a
 * client create outright, so this function is the only path).
 */

const CHICKEN = "chicken_breast_raw"; // 150 g DIY portion @ Rp 30,000, 106 kcal/100 g
const PASSWORD = "password123";

let h: Harness;

/** A Monday `weeks` weeks from the coming one, so the cutoff is still open. */
function mondayAhead(weeks: number): string {
  const now = new Date();
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dow = (new Date(utcMidnight).getUTCDay() + 6) % 7; // 0 = Monday
  const thisMonday = utcMidnight - dow * 86_400_000;
  return new Date(thisMonday + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
}

function meal(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    week: 1,
    day: 0,
    slot: "Lunch",
    servings: 1,
    items: [
      { ingredientId: CHICKEN, name: "Chicken", grams: 150, unitId: "g", quantity: 150 },
    ],
    snapshot: {
      name: "Chicken plate",
      totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    },
    ...over,
  };
}

async function seedPlan(
  uid: string,
  planId: string,
  over: Record<string, unknown> = {}
) {
  await adminSet(`users/${uid}/plans/${planId}`, {
    id: planId,
    ownerUid: uid,
    title: "My week",
    targets: null,
    mealSlots: ["Breakfast", "Lunch"],
    programStartDate: mondayAhead(3),
    weekCount: 2,
    assignments: [meal()],
    status: "draft",
    submittedWeeks: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  });
}

async function seedConfig(over: Record<string, unknown> = {}) {
  await adminSet(`restaurants/${RESTAURANT_ID}`, {
    id: RESTAURANT_ID,
    name: "Negrita",
    timezone: "Asia/Makassar",
    cutoffDay: 6,
    cutoffTime: "18:00",
    acceptingOrders: true,
    markupPct: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  });
}

let seq = 0;
async function signedInUser(): Promise<string> {
  const user = await h.signUp(`diner${(seq += 1)}-${Date.now()}@example.com`, PASSWORD);
  return user.uid;
}

const PICKUP = { 0: { mode: "pickup", time: "12:00" } };

beforeAll(() => {
  h = createHarness();
});

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
  await seedConfig();
});

afterEach(async () => {
  await h.auth.signOut().catch(() => {});
});

afterAll(async () => {
  await h?.dispose();
});

describe("authentication and arguments", () => {
  it("refuses an anonymous caller", async () => {
    await expect(
      h.call("submitOrder", { planId: "p1", weekNumber: 1 })
    ).rejects.toThrow(/unauthenticated|Sign in/i);
  });

  it.each([
    ["a missing planId", { weekNumber: 1 }],
    ["a non-string planId", { planId: 42, weekNumber: 1 }],
    ["a missing weekNumber", { planId: "p1" }],
    ["a zero weekNumber", { planId: "p1", weekNumber: 0 }],
    ["a fractional weekNumber", { planId: "p1", weekNumber: 1.5 }],
  ])("rejects %s", async (_label, payload) => {
    await signedInUser();
    await expect(h.call("submitOrder", payload)).rejects.toThrow(/invalid-argument|Which/i);
  });

  it("refuses a plan that does not exist", async () => {
    await signedInUser();
    await expect(
      h.call("submitOrder", { planId: "nope", weekNumber: 1 })
    ).rejects.toThrow(/not-found|does not exist/i);
  });

  it("refuses somebody else's plan", async () => {
    // The function reads users/{callerUid}/plans/{planId}, so another
    // person's plan id is simply not found for this caller.
    const other = await signedInUser();
    await seedPlan(other, "theirs");
    await h.auth.signOut();
    await signedInUser();
    await expect(
      h.call("submitOrder", { planId: "theirs", weekNumber: 1 })
    ).rejects.toThrow(/not-found|does not exist/i);
  });
});

describe("the happy path", () => {
  it("writes the order and one prep task per meal, in one batch", async () => {
    const uid = await signedInUser();
    await seedPlan(uid, "p1", {
      assignments: [meal(), meal({ id: "a2", day: 2, slot: "Breakfast" })],
    });

    const result = await h.call<unknown, { orderId: string; mealCount: number; priceIdr: number }>(
      "submitOrder",
      { planId: "p1", weekNumber: 1, fulfilment: { 0: { mode: "pickup", time: "12:00" }, 2: { mode: "pickup", time: "09:00" } } }
    );

    expect(result.mealCount).toBe(2);

    const order = await adminGet(`restaurants/${RESTAURANT_ID}/orders/${result.orderId}`);
    expect(order).toMatchObject({ userId: uid, planId: "p1", weekNumber: 1, status: "submitted" });

    const tasks = await adminList(`restaurants/${RESTAURANT_ID}/prepTasks`);
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.orderId === result.orderId)).toBe(true);
    expect(tasks.every((t) => t.status === "todo")).toBe(true);
  });

  it("marks the week submitted on the plan", async () => {
    const uid = await signedInUser();
    await seedPlan(uid, "p1");
    await h.call("submitOrder", { planId: "p1", weekNumber: 1, fulfilment: PICKUP });

    const plan = await adminGet(`users/${uid}/plans/p1`);
    expect(plan?.submittedWeeks).toEqual([1]);
    expect(plan?.status).toBe("submitted");
  });

  it("stamps the cutoff on the order as lockedAt", async () => {
    const uid = await signedInUser();
    await seedPlan(uid, "p1");
    const { orderId } = await h.call<unknown, { orderId: string }>("submitOrder", {
      planId: "p1", weekNumber: 1, fulfilment: PICKUP,
    });
    const order = await adminGet(`restaurants/${RESTAURANT_ID}/orders/${orderId}`);
    expect(Date.parse(String(order?.lockedAt))).toBeGreaterThan(Date.now());
  });

  it("copies the customer's profile onto the order for the kitchen", async () => {
    const uid = await signedInUser();
    // onUserCreate writes this document asynchronously with a displayName
    // derived from the email, so wait for it and then merge over the top —
    // otherwise the trigger races the seed and wins about half the time.
    await waitFor(async () => await adminGet(`users/${uid}`), {
      label: "profile created by onUserCreate",
    });
    await adminSet(
      `users/${uid}`,
      { displayName: "Mario Rossi", phone: "+62 812 1111 2222" },
      { merge: true }
    );
    await seedPlan(uid, "p1");
    const { orderId } = await h.call<unknown, { orderId: string }>("submitOrder", {
      planId: "p1", weekNumber: 1, fulfilment: PICKUP,
    });
    const order = await adminGet(`restaurants/${RESTAURANT_ID}/orders/${orderId}`);
    // This is the only route a phone number reaches the kitchen — and today
    // nothing in the UI ever writes one.
    expect(order?.customer).toMatchObject({
      name: "Mario Rossi",
      phone: "+62 812 1111 2222",
    });
  });
});

describe("the price is the server's, not the caller's", () => {
  it("recomputes the total from the plan it reads itself", async () => {
    const uid = await signedInUser();
    await seedPlan(uid, "p1");
    const result = await h.call<unknown, { priceIdr: number }>("submitOrder", {
      planId: "p1", weekNumber: 1, fulfilment: PICKUP,
    });
    // One 150 g chicken portion.
    expect(result.priceIdr).toBe(30_000);
  });

  it("ignores a price, totals or meal count supplied in the request", async () => {
    const uid = await signedInUser();
    await seedPlan(uid, "p1");
    const { orderId, priceIdr } = await h.call<unknown, { orderId: string; priceIdr: number }>(
      "submitOrder",
      {
        planId: "p1",
        weekNumber: 1,
        fulfilment: PICKUP,
        // None of this is read; the function rebuilds from the plan.
        priceIdr: 1,
        totals: { energy_kcal: 0 },
        mealCount: 99,
        status: "completed",
        payment: { status: "paid" },
      }
    );
    expect(priceIdr).toBe(30_000);
    const order = await adminGet(`restaurants/${RESTAURANT_ID}/orders/${orderId}`);
    expect(order?.priceIdr).toBe(30_000);
    expect(order?.mealCount).toBe(1);
    expect(order?.status).toBe("submitted");
    expect(order?.payment).toMatchObject({ status: "unpaid", amountIdr: 30_000 });
  });

  it("computes macros with the same code the browser uses", async () => {
    const uid = await signedInUser();
    await seedPlan(uid, "p1");
    const { orderId } = await h.call<unknown, { orderId: string }>("submitOrder", {
      planId: "p1", weekNumber: 1, fulfilment: PICKUP,
    });
    const order = await adminGet(`restaurants/${RESTAURANT_ID}/orders/${orderId}`);
    const totals = order?.totals as Record<string, number>;
    expect(totals.energy_kcal).toBeCloseTo(159, 4); // 106 * 1.5
  });

  it("scales with servings", async () => {
    const uid = await signedInUser();
    await seedPlan(uid, "p1", { assignments: [meal({ servings: 2 })] });
    const result = await h.call<unknown, { priceIdr: number }>("submitOrder", {
      planId: "p1", weekNumber: 1, fulfilment: PICKUP,
    });
    expect(result.priceIdr).toBe(60_000);
  });
});

describe("the cutoff is enforced", () => {
  it("accepts a week whose deadline has not passed", async () => {
    const uid = await signedInUser();
    await seedPlan(uid, "p1", { programStartDate: mondayAhead(3) });
    await expect(
      h.call("submitOrder", { planId: "p1", weekNumber: 1, fulfilment: PICKUP })
    ).resolves.toBeDefined();
  });

  it("refuses a week that has already closed", async () => {
    const uid = await signedInUser();
    // A week that began a fortnight ago closed long before now.
    await seedPlan(uid, "p1", { programStartDate: mondayAhead(-2) });
    await expect(
      h.call("submitOrder", { planId: "p1", weekNumber: 1, fulfilment: PICKUP })
    ).rejects.toThrow(/closed|failed-precondition/i);
  });

  it("applies the cutoff per week, not per plan", async () => {
    const uid = await signedInUser();
    // Week 1 is in the past; week 3 of the same plan is still open.
    await seedPlan(uid, "p1", {
      programStartDate: mondayAhead(-1),
      weekCount: 6,
      assignments: [meal({ week: 3 })],
    });
    await expect(
      h.call("submitOrder", { planId: "p1", weekNumber: 3, fulfilment: PICKUP })
    ).resolves.toBeDefined();
  });
});

describe("the restaurant can stop taking orders", () => {
  it("refuses every submit when acceptingOrders is false", async () => {
    await seedConfig({ acceptingOrders: false });
    const uid = await signedInUser();
    await seedPlan(uid, "p1");
    await expect(
      h.call("submitOrder", { planId: "p1", weekNumber: 1, fulfilment: PICKUP })
    ).rejects.toThrow(/not taking orders|failed-precondition/i);
  });
});

describe("a repeated submit", () => {
  it("treats a double click as one order", async () => {
    const uid = await signedInUser();
    await seedPlan(uid, "p1");
    const first = await h.call<unknown, { orderId: string }>("submitOrder", {
      planId: "p1", weekNumber: 1, fulfilment: PICKUP,
    });
    const second = await h.call<unknown, { orderId: string; deduplicated?: boolean }>(
      "submitOrder",
      { planId: "p1", weekNumber: 1, fulfilment: PICKUP }
    );
    expect(second.orderId).toBe(first.orderId);
    expect(second.deduplicated).toBe(true);
    expect(await adminList(`restaurants/${RESTAURANT_ID}/orders`)).toHaveLength(1);
  });

  it("refuses a genuine resubmit once the dedup window has passed", async () => {
    const uid = await signedInUser();
    await seedPlan(uid, "p1");
    const { orderId } = await h.call<unknown, { orderId: string }>("submitOrder", {
      planId: "p1", weekNumber: 1, fulfilment: PICKUP,
    });
    // Age the order past MIN_RESUBMIT_MS rather than waiting a minute. Merge,
    // or the PATCH would drop the userId/planId/weekNumber the duplicate check
    // queries on and the test would pass for the wrong reason.
    await adminSet(
      `restaurants/${RESTAURANT_ID}/orders/${orderId}`,
      { submittedAt: new Date(Date.now() - 5 * 60_000).toISOString() },
      { merge: true }
    );
    await expect(
      h.call("submitOrder", { planId: "p1", weekNumber: 1, fulfilment: PICKUP })
    ).rejects.toThrow(/already/i);
  });
});

describe("fulfilment is validated before it reaches the kitchen", () => {
  it("refuses a delivery with no address", async () => {
    const uid = await signedInUser();
    await seedPlan(uid, "p1");
    await expect(
      h.call("submitOrder", {
        planId: "p1", weekNumber: 1,
        fulfilment: { 0: { mode: "delivery", time: "18:00" } },
      })
    ).rejects.toThrow(/address/i);
  });

  it("accepts a delivery with one, and trims it onto the prep task", async () => {
    const uid = await signedInUser();
    await seedPlan(uid, "p1");
    const { orderId } = await h.call<unknown, { orderId: string }>("submitOrder", {
      planId: "p1", weekNumber: 1,
      fulfilment: { 0: { mode: "delivery", time: "18:00", address: "  Jl. Raya Canggu 1  " } },
    });
    const tasks = await adminList(`restaurants/${RESTAURANT_ID}/prepTasks`);
    expect(tasks[0]).toMatchObject({
      orderId, mode: "delivery", readyBy: "18:00", address: "Jl. Raya Canggu 1",
    });
  });

  it.each([
    ["an out-of-range day index", { 9: { mode: "pickup", time: "12:00" } }],
    ["a bogus mode", { 0: { mode: "teleport", time: "12:00" } }],
    ["a malformed time", { 0: { mode: "pickup", time: "25:99" } }],
    ["a non-numeric day key", { monday: { mode: "pickup", time: "12:00" } }],
  ])("drops %s and falls back to the default pickup", async (_label, fulfilment) => {
    // readFulfilment discards anything malformed; the day then takes
    // DEFAULT_FULFILMENT rather than the order being rejected outright.
    const uid = await signedInUser();
    await seedPlan(uid, "p1");
    const { orderId } = await h.call<unknown, { orderId: string }>("submitOrder", {
      planId: "p1", weekNumber: 1, fulfilment,
    });
    const order = await adminGet(`restaurants/${RESTAURANT_ID}/orders/${orderId}`);
    const days = order?.days as { fulfilment: { mode: string; time: string } }[];
    expect(days[0].fulfilment).toMatchObject({ mode: "pickup", time: "12:00" });
  });

  it("caps a long address rather than storing it whole", async () => {
    const uid = await signedInUser();
    await seedPlan(uid, "p1");
    const { orderId } = await h.call<unknown, { orderId: string }>("submitOrder", {
      planId: "p1", weekNumber: 1,
      fulfilment: { 0: { mode: "delivery", time: "18:00", address: "x".repeat(500) } },
    });
    const order = await adminGet(`restaurants/${RESTAURANT_ID}/orders/${orderId}`);
    const days = order?.days as { fulfilment: { address: string } }[];
    expect(days[0].fulfilment.address).toHaveLength(300);
  });
});

describe("an empty week", () => {
  it("is refused rather than becoming an order with nothing in it", async () => {
    const uid = await signedInUser();
    await seedPlan(uid, "p1", { assignments: [] });
    await expect(
      h.call("submitOrder", { planId: "p1", weekNumber: 1, fulfilment: PICKUP })
    ).rejects.toThrow(/no meals|failed-precondition/i);
  });

  it("is refused when the week asked for is not the week planned", async () => {
    const uid = await signedInUser();
    await seedPlan(uid, "p1", { assignments: [meal({ week: 1 })] });
    await expect(
      h.call("submitOrder", { planId: "p1", weekNumber: 2, fulfilment: PICKUP })
    ).rejects.toThrow(/no meals|failed-precondition/i);
  });

  it("writes no order and no prep tasks when it refuses", async () => {
    const uid = await signedInUser();
    await seedPlan(uid, "p1", { assignments: [] });
    await h.call("submitOrder", { planId: "p1", weekNumber: 1, fulfilment: PICKUP })
      .catch(() => {});
    expect(await adminList(`restaurants/${RESTAURANT_ID}/orders`)).toHaveLength(0);
    expect(await adminList(`restaurants/${RESTAURANT_ID}/prepTasks`)).toHaveLength(0);
  });
});
