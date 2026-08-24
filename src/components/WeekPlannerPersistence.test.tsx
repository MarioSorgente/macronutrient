// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dish, Plan, PlanRepository, MacroTargets } from "@/lib/storage/types";
import type { GeneratedDay } from "@/lib/mealPlanner";

/**
 * The reported bug, end to end through the real coordinator: apply a week,
 * leave the page, come back, and the week is still there.
 *
 * `/plan` sits in a `(tabs)` route group whose layout holds no state, so every
 * tab switch unmounts WeekPlanner and re-derives the plan from storage. Nothing
 * here mocks `@/lib/currentPlan` — the point is to exercise the load barrier
 * and the write queue, not to assume them.
 */

const RESOLVED: MacroTargets = {
  energy_kcal: 2000, protein_g: 125, carbs_g: 225, fat_g: 66.7,
};
const SLOTS = ["Breakfast", "Lunch", "Dinner"];

/**
 * A repository that can be made slow or made to fail, like a real one.
 *
 * Built inside `vi.hoisted` because `vi.mock` factories are hoisted above every
 * other statement in the file, and they need this to already exist.
 */
const { backing, mocks } = vi.hoisted(() => {
  const store = new Map<string, Plan>();
  const saves: Plan[] = [];
  const state = { hold: null as Promise<void> | null, fail: null as Error | null };
  const repo: PlanRepository = {
    async list() { return [...store.values()]; },
    async latest() {
      return [...store.values()].reduce<Plan | null>((newest, plan) =>
        !newest || plan.updatedAt > newest.updatedAt ? plan : newest, null);
    },
    async get(id) { return store.get(id) ?? null; },
    async save(plan) {
      if (state.hold) await state.hold;
      if (state.fail) throw state.fail;
      saves.push(plan);
      store.set(plan.id, plan);
      return plan;
    },
    async remove(id) { store.delete(id); },
  };
  const repos = {
    plans: repo,
    dishes: { list: vi.fn(), save: vi.fn() },
    houseRecipes: {},
    uid: "u1" as string | null,
    loading: false,
  };
  return { backing: { repo, store, saves, state, repos },
    mocks: { listDishes: repos.dishes.list } };
});



// The real useRepos memoises on [uid, loading], so its identity is stable
// across renders. The stub must be stable too, or the planner's load effect
// re-fires on every render and keeps overwriting the state under test.
vi.mock("@/lib/storage/repos", () => ({ useRepos: () => backing.repos }));
vi.mock("@/lib/planView", () => ({
  usePlanView: () => ["week", vi.fn()],
  useShowPrices: () => [false, vi.fn()],
}));
vi.mock("@/store/houseRecipes", () => ({
  useHouseRecipes: (selector: (state: { version: number }) => number) =>
    selector({ version: 0 }),
}));
vi.mock("@/components/HouseRecipeLoader", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
// The grid reports what the loaded plan actually contains, which is the thing
// under test: after a remount, are the meals still in the plan?
vi.mock("@/components/PlanWeekGrid", () => ({
  default: ({ plan }: { plan: Plan }) => (
    <div data-testid="week">{plan.assignments.filter((a) => a.week === 1).length}</div>
  ),
}));
vi.mock("@/components/MacroSummary", () => ({ default: () => null }));
vi.mock("@/components/TargetAdherence", () => ({ default: () => null }));
vi.mock("@/components/SegmentedToggle", () => ({ default: () => null }));

const generated: GeneratedDay[] = Array.from({ length: 7 }, (_, day) => ({
  day,
  meals: SLOTS.map((slot) => ({
    slot, name: `${slot} ${day}`,
    items: [{ ingredientId: "chicken_breast_raw", name: "Chicken", grams: 150,
      unitId: "g", quantity: 150 }],
    macros: { energy_kcal: 600, protein_g: 50, carbs_g: 60, fat_g: 20, fiber_g: 3 },
    price: { totalIdr: 50_000, complete: true, unpricedCount: 0 },
    kind: "ready" as const, dishStyle: "rice-bowl",
  })),
  macros: { energy_kcal: 1800, protein_g: 150, carbs_g: 180, fat_g: 60, fiber_g: 9 },
  price: { totalIdr: 150_000, complete: true, unpricedCount: 0 },
  unfilledSlots: [],
  adherence: { classification: "Within tolerance" },
})) as unknown as GeneratedDay[];

vi.mock("@/components/GeneratePlanDialog", () => ({
  default: ({ onApply }: {
    onApply: (days: GeneratedDay[], replace: boolean, preferences: unknown,
      resolvedTarget: MacroTargets) => Promise<boolean> | void;
  }) => (
    <button type="button" onClick={() =>
      void onApply(generated, true, { macroStyle: "balanced", proteinLean: [],
        avoidIngredientIds: [] }, RESOLVED)}>
      apply generated week
    </button>
  ),
}));

import WeekPlanner from "@/components/WeekPlanner";
import { __resetPlanCache } from "@/lib/currentPlan";

async function mountPlanner(): Promise<ReturnType<typeof render>> {
  const view = render(<WeekPlanner />);
  await screen.findByText("Auto-fill my week");
  return view;
}

async function applyWeek(): Promise<void> {
  await act(async () => { fireEvent.click(screen.getByText("Auto-fill my week")); });
  await act(async () => { fireEvent.click(screen.getByText("apply generated week")); });
}

const weekCount = () => Number(screen.getByTestId("week").textContent);

describe("an applied week survives leaving the page", () => {
  beforeEach(() => {
    cleanup();
    __resetPlanCache();
    backing.store.clear();
    backing.saves.length = 0;
    backing.state.hold = null;
    backing.state.fail = null;
    backing.repos.uid = "u1";
    mocks.listDishes.mockResolvedValue([] as Dish[]);
  });
  afterEach(() => __resetPlanCache());

  it("is still there after navigating away and back", async () => {
    const view = await mountPlanner();
    await applyWeek();
    expect(weekCount()).toBe(21);

    // Switching tabs unmounts the planner; coming back mounts a new one that
    // re-reads storage from scratch.
    view.unmount();
    await mountPlanner();

    expect(weekCount()).toBe(21);
  });

  it("survives a reload, with its target and preferences", async () => {
    await mountPlanner();
    await applyWeek();

    // A reload keeps the stored documents and drops everything in memory.
    cleanup();
    __resetPlanCache();
    await mountPlanner();

    expect(weekCount()).toBe(21);
    const stored = await backing.repo.latest();
    expect(stored?.targets).toEqual(RESOLVED);
    expect(stored?.preferences).toMatchObject({ macroStyle: "balanced" });
  });

  it("does not lose the week when the planner unmounts mid-save", async () => {
    const view = await mountPlanner();
    // Armed only now: the first load creates and writes the plan, and holding
    // that would just be testing a stuck mount.
    let release!: () => void;
    backing.state.hold = new Promise<void>((resolve) => { release = () => resolve(); });

    await act(async () => { fireEvent.click(screen.getByText("Auto-fill my week")); });
    await act(async () => { fireEvent.click(screen.getByText("apply generated week")); });

    // Leave while the write is still outstanding.
    view.unmount();
    backing.state.hold = null;
    await act(async () => { release(); });

    await mountPlanner();
    expect(weekCount()).toBe(21);
  });

  it("keeps showing the week when the save failed, rather than reverting", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = await mountPlanner();
    backing.state.fail = new Error("offline");
    await applyWeek();

    expect(await screen.findByTestId("save-error")).toBeDefined();
    expect(consoleError).toHaveBeenCalled();
    expect(weekCount()).toBe(21);

    // The remount must not quietly replace the unsaved week with the stored
    // one: the copy on screen is the only copy that exists.
    view.unmount();
    await mountPlanner();
    expect(weekCount()).toBe(21);
    consoleError.mockRestore();
  });

  it("refuses to write into a different account's storage", async () => {
    await mountPlanner();
    await applyWeek();
    const writes = backing.saves.length;

    // A token expiry or a sign-out in another tab swaps the repository under a
    // plan that was loaded for someone else. Nothing but this check ties the
    // plan in state to the store it came from.
    backing.repos.uid = null;
    await applyWeek();

    expect(backing.saves).toHaveLength(writes);
    expect(screen.getByTestId("save-error").textContent)
      .toMatch(/signed in as someone else/i);
    backing.repos.uid = "u1";
  });

  it("never creates an empty plan over one that is already stored", async () => {
    await mountPlanner();
    await applyWeek();
    const before = await backing.repo.latest();

    // An offline read resolves null from an empty cache rather than rejecting.
    const latest = backing.repo.latest;
    backing.repo.latest = async () => null;
    cleanup();
    __resetPlanCache();
    await mountPlanner();
    backing.repo.latest = latest;

    expect(weekCount()).toBe(21);
    expect((await backing.repo.latest())?.assignments).toHaveLength(
      before!.assignments.length
    );
  });
});
