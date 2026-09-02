import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dish, Plan } from "@/lib/storage/types";

const mocks = vi.hoisted(() => ({
  guestPlans: [] as Plan[],
  guestDishes: [] as Dish[],
  cloudPlans: [] as Plan[],
  cloudDishes: [] as Dish[],
  cleared: false,
}));

/** When set, every guest `list()` waits for this — the interleave lever. */
let holdGuestList: Promise<void> | null = null;

function planRepo(store: Plan[], hold?: () => Promise<void> | null) {
  return {
    list: async () => {
      const wait = hold?.();
      if (wait) await wait;
      return store;
    },
    latest: async () => store[0] ?? null,
    get: async (id: string) => store.find((p) => p.id === id) ?? null,
    save: async (p: Plan) => {
      const i = store.findIndex((x) => x.id === p.id);
      if (i >= 0) store[i] = p;
      else store.push(p);
      return p;
    },
    remove: async () => {},
  };
}

function dishRepo(store: Dish[]) {
  return {
    list: async () => store,
    latest: async () => store[0] ?? null,
    get: async (id: string) => store.find((d) => d.id === id) ?? null,
    save: async (d: Dish) => {
      store.push(d);
      return d;
    },
    remove: async () => {},
  };
}

vi.mock("@/lib/storage", () => ({
  isCloudBackend: () => true,
  getPlanRepository: () => planRepo(mocks.cloudPlans),
  getDishRepository: () => dishRepo(mocks.cloudDishes),
  guestStores: {
    plans: () => planRepo(mocks.guestPlans, () => holdGuestList),
    dishes: () => dishRepo(mocks.guestDishes),
    clear: () => {
      mocks.cleared = true;
    },
  },
}));

import { claimGuestData } from "@/lib/storage/claim";
import { __resetPlanCache, loadCurrentPlan } from "@/lib/currentPlan";

function makePlan(id: string, assignments: number): Plan {
  return {
    id,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ownerUid: "",
    title: "My week",
    targets: null,
    targetMode: "preset",
    mealSlots: ["Lunch"],
    programStartDate: "2026-08-24",
    weekCount: 4,
    status: "draft",
    submittedWeeks: [],
    assignments: Array.from({ length: assignments }, (_, i) => ({
      id: `a${i}`,
      week: 1,
      day: i % 7,
      slot: "Lunch",
      servings: 1,
      snapshot: {
        name: "Meal",
        totals: { energy_kcal: 500, protein_g: 30, carbs_g: 50, fat_g: 15, fiber_g: 5 },
      },
    })),
  };
}

describe("claimGuestData", () => {
  beforeEach(() => {
    mocks.guestPlans = [];
    mocks.guestDishes = [];
    mocks.cloudPlans = [];
    mocks.cloudDishes = [];
    mocks.cleared = false;
  });

  it("moves a guest week into an empty account", async () => {
    mocks.guestPlans = [makePlan("primary", 9)];

    const moved = await claimGuestData("uid-1");

    expect(moved.plans).toBe(1);
    expect(mocks.cloudPlans).toHaveLength(1);
    expect(mocks.cloudPlans[0].assignments).toHaveLength(9);
    expect(mocks.cloudPlans[0].ownerUid).toBe("uid-1");
    expect(mocks.cleared).toBe(true);
  });

  it("does not lose the guest week when an empty plan was auto-created first", async () => {
    // The planner and the claim both react to sign-in. If the planner wins it
    // creates an empty plan under the same fixed id, and the guest's real week
    // must still survive.
    mocks.cloudPlans = [makePlan("primary", 0)];
    mocks.guestPlans = [makePlan("primary", 9)];

    await claimGuestData("uid-1");

    const kept = mocks.cloudPlans.flatMap((p) => p.assignments);
    expect(kept).toHaveLength(9);
    expect(mocks.cleared).toBe(true);
  });

  it("never overwrites a real plan already in the account", async () => {
    // A second device signing in must not clobber what the first one saved.
    mocks.cloudPlans = [makePlan("primary", 20)];
    mocks.guestPlans = [makePlan("primary", 3)];

    await claimGuestData("uid-1");

    const existing = mocks.cloudPlans.find((p) => p.assignments.length === 20);
    expect(existing, "the account's own plan survives").toBeDefined();
    const total = mocks.cloudPlans.flatMap((p) => p.assignments).length;
    expect(total, "the guest week is kept too, not silently dropped").toBe(23);
  });

  /**
   * The one that cost somebody their week.
   *
   * Both this and the planner react to the same sign-in. The claim reads, decides
   * the guest week may take the fixed `primary` id, writes it, and only then
   * clears localStorage — while `loadCurrentPlan`, finding nothing yet, creates
   * an empty plan at that same id with a plain replace. Interleaved the wrong
   * way round, the empty plan lands on top of the claimed week moments after the
   * only other copy of it was deleted.
   */
  it("is not overwritten by the planner creating an empty plan at the same id", async () => {
    __resetPlanCache();
    mocks.guestPlans = [makePlan("primary", 7)];

    // Hold the claim open at its first read, so the planner is guaranteed to see
    // an empty account — the losing order, made deterministic.
    let release = () => {};
    holdGuestList = new Promise<void>((resolve) => { release = resolve; });

    const claiming = claimGuestData("uid-1");
    const loading = loadCurrentPlan(planRepo(mocks.cloudPlans), "uid-1");

    release();
    holdGuestList = null;
    const [moved, loaded] = await Promise.all([claiming, loading]);

    expect(moved.plans).toBe(1);
    expect(loaded.assignments, "the loader must not serve an empty week").toHaveLength(7);
    expect(
      mocks.cloudPlans.flatMap((p) => p.assignments),
      "the claimed week survives in the account"
    ).toHaveLength(7);
    expect(mocks.cleared).toBe(true);
  });

  it("does nothing when there is nothing on the device", async () => {
    const moved = await claimGuestData("uid-1");
    expect(moved).toEqual({ plans: 0, dishes: 0 });
    expect(mocks.cleared).toBe(false);
  });
});
