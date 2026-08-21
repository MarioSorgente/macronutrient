import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dish, Plan } from "@/lib/storage/types";

const mocks = vi.hoisted(() => ({
  guestPlans: [] as Plan[],
  guestDishes: [] as Dish[],
  cloudPlans: [] as Plan[],
  cloudDishes: [] as Dish[],
  cleared: false,
}));

function planRepo(store: Plan[]) {
  return {
    list: async () => store,
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
    plans: () => planRepo(mocks.guestPlans),
    dishes: () => dishRepo(mocks.guestDishes),
    clear: () => {
      mocks.cleared = true;
    },
  },
}));

import { claimGuestData } from "@/lib/storage/claim";

function makePlan(id: string, assignments: number): Plan {
  return {
    id,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ownerUid: "",
    title: "My week",
    targets: null,
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

  it("does nothing when there is nothing on the device", async () => {
    const moved = await claimGuestData("uid-1");
    expect(moved).toEqual({ plans: 0, dishes: 0 });
    expect(mocks.cleared).toBe(false);
  });
});
