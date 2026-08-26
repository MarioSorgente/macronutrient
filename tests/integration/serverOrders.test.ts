import { beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "@/lib/server/firebaseAdmin";
import { setOrderStatus, submitOrder } from "@/lib/server/orders";
import { HttpError } from "@/lib/server/auth";
import {
  RID,
  createUser,
  docAt,
  listAt,
  meal,
  mondayAhead,
  resetEmulators,
  seedPlan,
  seedRestaurant,
  uniqueEmail,
} from "./serverHarness";
import { menuRecipes } from "@/lib/database";
import { negritaMenuCandidate } from "@/lib/plannerCandidates";

/**
 * The order pipeline, as /api/orders/submit and /api/orders/status run it.
 *
 * Three things are deliberately server-side and each is asserted here: the
 * price (recomputed from the plan the server reads itself), the cutoff
 * (enforced in Bali time), and the fact that an order exists at all — the
 * security rules deny a browser create outright, so this is the only path.
 */

const PICKUP = { 0: { mode: "pickup", time: "12:00" } };

async function aUser(): Promise<string> {
  return createUser(uniqueEmail("diner"));
}

beforeEach(async () => {
  await resetEmulators();
  await seedRestaurant();
});

describe("arguments", () => {
  it.each([
    ["a missing planId", { weekNumber: 1 }],
    ["a non-string planId", { planId: 42, weekNumber: 1 }],
    ["a missing weekNumber", { planId: "p1" }],
    ["a zero weekNumber", { planId: "p1", weekNumber: 0 }],
    ["a fractional weekNumber", { planId: "p1", weekNumber: 1.5 }],
  ])("rejects %s", async (_label, input) => {
    await expect(submitOrder(await aUser(), input)).rejects.toBeInstanceOf(HttpError);
  });

  it("refuses a plan that does not exist", async () => {
    await expect(
      submitOrder(await aUser(), { planId: "nope", weekNumber: 1 })
    ).rejects.toThrow(/does not exist/i);
  });

  it("refuses somebody else's plan", async () => {
    // The lookup is scoped to the caller's own uid, so another person's plan
    // id is simply not found for them.
    const other = await aUser();
    await seedPlan(other, "theirs");
    await expect(
      submitOrder(await aUser(), { planId: "theirs", weekNumber: 1 })
    ).rejects.toThrow(/does not exist/i);
  });
});

describe("the happy path", () => {
  it("writes the order and one prep task per meal, in one batch", async () => {
    const uid = await aUser();
    await seedPlan(uid, "p1", {
      assignments: [meal(), meal({ id: "a2", day: 2, slot: "Breakfast" })],
    });

    const result = await submitOrder(uid, {
      planId: "p1",
      weekNumber: 1,
      fulfilment: { 0: { mode: "pickup", time: "12:00" }, 2: { mode: "pickup", time: "09:00" } },
    });
    expect(result.mealCount).toBe(2);

    const order = await docAt(`restaurants/${RID}/orders/${result.orderId}`);
    expect(order).toMatchObject({ userId: uid, planId: "p1", status: "submitted" });

    const tasks = await listAt(`restaurants/${RID}/prepTasks`);
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.orderId === result.orderId)).toBe(true);
    expect(tasks.every((t) => t.status === "todo")).toBe(true);
  });

  it("marks the week submitted on the plan", async () => {
    const uid = await aUser();
    await seedPlan(uid);
    await submitOrder(uid, { planId: "p1", weekNumber: 1, fulfilment: PICKUP });
    const plan = await docAt(`users/${uid}/plans/p1`);
    expect(plan?.submittedWeeks).toEqual([1]);
    expect(plan?.status).toBe("submitted");
  });

  it("stamps the cutoff on the order as lockedAt", async () => {
    const uid = await aUser();
    await seedPlan(uid);
    const { orderId } = await submitOrder(uid, {
      planId: "p1", weekNumber: 1, fulfilment: PICKUP,
    });
    const order = await docAt(`restaurants/${RID}/orders/${orderId}`);
    expect(Date.parse(String(order?.lockedAt))).toBeGreaterThan(Date.now());
  });

  it("copies the customer's profile onto the order for the kitchen", async () => {
    const uid = await aUser();
    await adminDb().doc(`users/${uid}`).set({
      uid, email: "diner@example.com", displayName: "Mario Rossi",
      phone: "+62 812 1111 2222",
    });
    await seedPlan(uid);
    const { orderId } = await submitOrder(uid, {
      planId: "p1", weekNumber: 1, fulfilment: PICKUP,
    });
    const order = await docAt(`restaurants/${RID}/orders/${orderId}`);
    // This is the only route a phone number reaches the kitchen.
    expect(order?.customer).toMatchObject({
      name: "Mario Rossi",
      phone: "+62 812 1111 2222",
    });
  });
});

describe("the price is the server's, not the caller's", () => {
  it("recomputes the total from the plan it reads itself", async () => {
    const uid = await aUser();
    await seedPlan(uid);
    // One 150 g chicken portion.
    await expect(
      submitOrder(uid, { planId: "p1", weekNumber: 1, fulfilment: PICKUP })
    ).resolves.toMatchObject({ priceIdr: 30_000 });
  });

  it("bills a Negrita menu dish at the menu's price, identity or not", async () => {
    const uid = await aUser();
    const recipe = menuRecipes.find((entry) =>
      entry.recipe_id === "special_protein_pancake")!;
    const candidate = negritaMenuCandidate(recipe)!;
    // A week planned before menu identity existed: the ingredient list and a
    // name, and nothing saying which menu dish it is. The browser gives it that
    // identity when it loads the plan, and this read has to agree — otherwise
    // the diner is quoted Rp 89,000 and the kitchen is billed the Rp 15,000 its
    // components come to.
    await seedPlan(uid, "p1", { assignments: [meal({
      slot: "Breakfast",
      items: candidate.breakdown.map((item) => ({
        ingredientId: item.ingredientId, name: item.name, grams: item.grams,
        unitId: "g", quantity: item.grams,
      })),
      snapshot: { name: recipe.name, totals: candidate.optimizerMacros },
    })] });

    await expect(
      submitOrder(uid, { planId: "p1", weekNumber: 1, fulfilment: PICKUP })
    ).resolves.toMatchObject({ priceIdr: 89_000 });
  });

  it("ignores a price, totals or status supplied in the request", async () => {
    const uid = await aUser();
    await seedPlan(uid);
    const { orderId, priceIdr } = await submitOrder(uid, {
      planId: "p1", weekNumber: 1, fulfilment: PICKUP,
      // None of this is read; the server rebuilds from the plan.
      priceIdr: 1, totals: { energy_kcal: 0 }, mealCount: 99,
      status: "completed", payment: { status: "paid" },
    } as Record<string, unknown>);

    expect(priceIdr).toBe(30_000);
    const order = await docAt(`restaurants/${RID}/orders/${orderId}`);
    expect(order).toMatchObject({ priceIdr: 30_000, mealCount: 1, status: "submitted" });
    expect(order?.payment).toMatchObject({ status: "unpaid", amountIdr: 30_000 });
  });

  it("computes macros with the same code the browser uses", async () => {
    const uid = await aUser();
    await seedPlan(uid);
    const { orderId } = await submitOrder(uid, {
      planId: "p1", weekNumber: 1, fulfilment: PICKUP,
    });
    const order = await docAt(`restaurants/${RID}/orders/${orderId}`);
    expect((order?.totals as Record<string, number>).energy_kcal).toBeCloseTo(159, 4);
  });

  it("scales with servings", async () => {
    const uid = await aUser();
    await seedPlan(uid, "p1", { assignments: [meal({ servings: 2 })] });
    await expect(
      submitOrder(uid, { planId: "p1", weekNumber: 1, fulfilment: PICKUP })
    ).resolves.toMatchObject({ priceIdr: 60_000 });
  });
});

describe("the cutoff is enforced", () => {
  it("accepts a week whose deadline has not passed", async () => {
    const uid = await aUser();
    await seedPlan(uid, "p1", { programStartDate: mondayAhead(3) });
    await expect(
      submitOrder(uid, { planId: "p1", weekNumber: 1, fulfilment: PICKUP })
    ).resolves.toBeDefined();
  });

  it("refuses a week that has already closed", async () => {
    const uid = await aUser();
    await seedPlan(uid, "p1", { programStartDate: mondayAhead(-2) });
    await expect(
      submitOrder(uid, { planId: "p1", weekNumber: 1, fulfilment: PICKUP })
    ).rejects.toThrow(/closed/i);
  });

  it("applies the cutoff per week, not per plan", async () => {
    // One plan straddling the deadline: its opening weeks have closed while a
    // later week is still open. A cutoff computed from the plan rather than the
    // week would reject both.
    //
    // Week 4 rather than week 3, and asserted in both directions. Week 3 of a
    // plan starting last Monday closes *this* Sunday at 18:00 Bali, so the
    // original version of this test quietly stopped being true for the last six
    // hours of every week — it failed for real on a Sunday evening. Week 4's
    // deadline is a further seven days out, which no run time can reach.
    const uid = await aUser();
    await seedPlan(uid, "p1", {
      programStartDate: mondayAhead(-1),
      weekCount: 6,
      assignments: [meal({ week: 1 }), meal({ week: 4 })],
    });

    await expect(
      submitOrder(uid, { planId: "p1", weekNumber: 1, fulfilment: PICKUP })
    ).rejects.toThrow(/closed/i);
    await expect(
      submitOrder(uid, { planId: "p1", weekNumber: 4, fulfilment: PICKUP })
    ).resolves.toBeDefined();
  });
});

describe("the restaurant can stop taking orders", () => {
  it("refuses every submit when acceptingOrders is false", async () => {
    await seedRestaurant({ acceptingOrders: false });
    const uid = await aUser();
    await seedPlan(uid);
    await expect(
      submitOrder(uid, { planId: "p1", weekNumber: 1, fulfilment: PICKUP })
    ).rejects.toThrow(/not taking orders/i);
  });
});

describe("a repeated submit", () => {
  it("treats a double click as one order", async () => {
    const uid = await aUser();
    await seedPlan(uid);
    const first = await submitOrder(uid, { planId: "p1", weekNumber: 1, fulfilment: PICKUP });
    const second = await submitOrder(uid, { planId: "p1", weekNumber: 1, fulfilment: PICKUP });
    expect(second.orderId).toBe(first.orderId);
    expect(second.deduplicated).toBe(true);
    expect(await listAt(`restaurants/${RID}/orders`)).toHaveLength(1);
  });

  it("refuses a genuine resubmit once the dedup window has passed", async () => {
    const uid = await aUser();
    await seedPlan(uid);
    const { orderId } = await submitOrder(uid, {
      planId: "p1", weekNumber: 1, fulfilment: PICKUP,
    });
    // Age it rather than waiting a minute.
    await adminDb()
      .doc(`restaurants/${RID}/orders/${orderId}`)
      .update({ submittedAt: new Date(Date.now() - 5 * 60_000).toISOString() });

    await expect(
      submitOrder(uid, { planId: "p1", weekNumber: 1, fulfilment: PICKUP })
    ).rejects.toThrow(/already/i);
  });
});

describe("fulfilment is validated before it reaches the kitchen", () => {
  it("refuses a delivery with no address", async () => {
    const uid = await aUser();
    await seedPlan(uid);
    await expect(
      submitOrder(uid, {
        planId: "p1", weekNumber: 1,
        fulfilment: { 0: { mode: "delivery", time: "18:00" } },
      })
    ).rejects.toThrow(/address/i);
  });

  it("accepts one, and trims it onto the prep task", async () => {
    const uid = await aUser();
    await seedPlan(uid);
    const { orderId } = await submitOrder(uid, {
      planId: "p1", weekNumber: 1,
      fulfilment: { 0: { mode: "delivery", time: "18:00", address: "  Jl. Raya Canggu 1  " } },
    });
    const tasks = await listAt(`restaurants/${RID}/prepTasks`);
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
    const uid = await aUser();
    await seedPlan(uid);
    const { orderId } = await submitOrder(uid, { planId: "p1", weekNumber: 1, fulfilment });
    const order = await docAt(`restaurants/${RID}/orders/${orderId}`);
    const days = order?.days as { fulfilment: { mode: string; time: string } }[];
    expect(days[0].fulfilment).toMatchObject({ mode: "pickup", time: "12:00" });
  });

  it("caps a long address rather than storing it whole", async () => {
    const uid = await aUser();
    await seedPlan(uid);
    const { orderId } = await submitOrder(uid, {
      planId: "p1", weekNumber: 1,
      fulfilment: { 0: { mode: "delivery", time: "18:00", address: "x".repeat(500) } },
    });
    const order = await docAt(`restaurants/${RID}/orders/${orderId}`);
    const days = order?.days as { fulfilment: { address: string } }[];
    expect(days[0].fulfilment.address).toHaveLength(300);
  });
});

describe("an empty week", () => {
  it("is refused rather than becoming an order with nothing in it", async () => {
    const uid = await aUser();
    await seedPlan(uid, "p1", { assignments: [] });
    await expect(
      submitOrder(uid, { planId: "p1", weekNumber: 1, fulfilment: PICKUP })
    ).rejects.toThrow(/no meals/i);
  });

  it("writes no order and no prep tasks when it refuses", async () => {
    const uid = await aUser();
    await seedPlan(uid, "p1", { assignments: [] });
    await submitOrder(uid, { planId: "p1", weekNumber: 1, fulfilment: PICKUP }).catch(() => {});
    expect(await listAt(`restaurants/${RID}/orders`)).toHaveLength(0);
    expect(await listAt(`restaurants/${RID}/prepTasks`)).toHaveLength(0);
  });
});

describe("moving an order through its lifecycle", () => {
  /**
   * This cascade used to be a Firestore trigger. It runs in the same request
   * as the status change now, so there is no window in which an order is dead
   * but the kitchen is still cooking it.
   */
  async function anOrder() {
    const uid = await createUser(uniqueEmail("diner"));
    await seedPlan(uid, "p1", {
      assignments: [meal(), meal({ id: "a2", day: 1 })],
    });
    const { orderId } = await submitOrder(uid, {
      planId: "p1", weekNumber: 1,
      fulfilment: { 0: { mode: "pickup", time: "12:00" }, 1: { mode: "pickup", time: "12:00" } },
    });
    return { uid, orderId };
  }

  const staff = { uid: "staff", role: "restaurant" };

  it.each(["cancelled", "rejected"])(
    "clears every prep task when an order becomes %s",
    async (status) => {
      const { orderId } = await anOrder();
      expect(await listAt(`restaurants/${RID}/prepTasks`)).toHaveLength(2);
      await setOrderStatus(staff, orderId, status);
      expect(await listAt(`restaurants/${RID}/prepTasks`)).toHaveLength(0);
    }
  );

  it("frees the week so the customer can fix and resend it", async () => {
    const { uid, orderId } = await anOrder();
    expect((await docAt(`users/${uid}/plans/p1`))?.submittedWeeks).toEqual([1]);
    await setOrderStatus(staff, orderId, "cancelled");
    expect((await docAt(`users/${uid}/plans/p1`))?.submittedWeeks).toEqual([]);
  });

  it("lets the customer actually resend it afterwards", async () => {
    // Regression: the duplicate check once counted the cancelled order too, so
    // the week became permanently un-orderable while the UI showed it editable.
    const { uid, orderId } = await anOrder();
    await setOrderStatus(staff, orderId, "cancelled");
    await adminDb()
      .doc(`restaurants/${RID}/orders/${orderId}`)
      .update({ submittedAt: new Date(Date.now() - 5 * 60_000).toISOString() });

    const resent = await submitOrder(uid, {
      planId: "p1", weekNumber: 1,
      fulfilment: { 0: { mode: "pickup", time: "12:00" }, 1: { mode: "pickup", time: "12:00" } },
    });
    expect(resent.orderId).not.toBe(orderId);
    expect(await listAt(`restaurants/${RID}/prepTasks`)).toHaveLength(2);
  });

  it("leaves the board alone for a live status change", async () => {
    const { orderId } = await anOrder();
    await setOrderStatus(staff, orderId, "accepted");
    expect(await listAt(`restaurants/${RID}/prepTasks`)).toHaveLength(2);
  });

  it("records who changed it, and when", async () => {
    const { orderId } = await anOrder();
    await setOrderStatus(staff, orderId, "accepted", "starting prep");
    const order = await docAt(`restaurants/${RID}/orders/${orderId}`);
    const history = order?.statusHistory as { status: string; byUid: string }[];
    expect(history.at(-1)).toMatchObject({ status: "accepted", byUid: "staff" });
    expect(order?.restaurantNote).toBe("starting prep");
  });

  it("keeps that note to a sane length", async () => {
    const { orderId } = await anOrder();
    await setOrderStatus(staff, orderId, "accepted", "x".repeat(2_000));
    const order = await docAt(`restaurants/${RID}/orders/${orderId}`);
    expect((order?.restaurantNote as string).length).toBe(500);
  });
});

describe("who may change an order", () => {
  async function anOrderFor(uid: string) {
    await seedPlan(uid);
    const { orderId } = await submitOrder(uid, {
      planId: "p1", weekNumber: 1, fulfilment: PICKUP,
    });
    return orderId;
  }

  it("lets a customer cancel their own submitted week", async () => {
    const uid = await aUser();
    const orderId = await anOrderFor(uid);
    await expect(setOrderStatus({ uid, role: "client" }, orderId, "cancelled"))
      .resolves.toMatchObject({ status: "cancelled" });
  });

  it("does not let a customer write the note signed \"From Negrita\"", async () => {
    const uid = await aUser();
    const orderId = await anOrderFor(uid);
    await setOrderStatus({ uid, role: "client" }, orderId, "cancelled",
      "Refund issued, call this number");

    // The receipt renders this as the restaurant's own words, so it is the
    // restaurant's to write. A customer cancelling could put words in its mouth.
    const order = await docAt(`restaurants/${RID}/orders/${orderId}`);
    expect(order?.restaurantNote).toBeUndefined();
  });

  it("refuses a customer any transition other than cancelling", async () => {
    const uid = await aUser();
    const orderId = await anOrderFor(uid);
    await expect(
      setOrderStatus({ uid, role: "client" }, orderId, "completed")
    ).rejects.toThrow(/only cancel/i);
  });

  it("refuses a cancel once the kitchen has accepted", async () => {
    // The UI hides the button at this point; this is the boundary behind it.
    const uid = await aUser();
    const orderId = await anOrderFor(uid);
    await setOrderStatus({ uid: "staff", role: "admin" }, orderId, "accepted");
    await expect(
      setOrderStatus({ uid, role: "client" }, orderId, "cancelled")
    ).rejects.toThrow(/already started/i);
  });

  it("hides someone else's order rather than admitting it exists", async () => {
    const owner = await aUser();
    const orderId = await anOrderFor(owner);
    await expect(
      setOrderStatus({ uid: "someone-else", role: "client" }, orderId, "cancelled")
    ).rejects.toThrow(/does not exist/i);
  });

  it("rejects a status that is not one", async () => {
    const uid = await aUser();
    const orderId = await anOrderFor(uid);
    await expect(
      setOrderStatus({ uid: "staff", role: "admin" }, orderId, "teleported")
    ).rejects.toThrow(/not a valid order status/i);
  });

  it("rejects a missing order id", async () => {
    await expect(
      setOrderStatus({ uid: "staff", role: "admin" }, "", "accepted")
    ).rejects.toThrow(/which order/i);
  });
});
