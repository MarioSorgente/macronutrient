// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Plan, MacroTargets } from "@/lib/storage/types";
import type { GeneratedDay } from "@/lib/mealPlanner";

/**
 * Applying a generated week has to persist it — and has to say so when it
 * could not. The week used to be painted into React state and the write
 * dropped: `applyGenerated` discarded the promise, so a rejected save left a
 * full seven-day plan on screen that had never been written, and the next time
 * the planner mounted it was gone with nothing to explain it.
 *
 * It also has to persist the target it was generated against. A plan created
 * from "Auto → Balanced 2000 kcal" saved with `targets: null`, so the preview
 * measured the week against 2000 kcal and the saved plan measured it against
 * nothing at all.
 */

const RESOLVED: MacroTargets = {
  energy_kcal: 2000, protein_g: 125, carbs_g: 225, fat_g: 66.66666666666667,
};

const mocks = vi.hoisted(() => ({
  loadCurrentPlan: vi.fn(),
  savePlan: vi.fn(),
  listDishes: vi.fn(),
}));

vi.mock("@/lib/currentPlan", async () => {
  const actual = await vi.importActual<typeof import("@/lib/currentPlan")>(
    "@/lib/currentPlan"
  );
  return { ...actual, loadCurrentPlan: mocks.loadCurrentPlan, savePlan: mocks.savePlan };
});
vi.mock("@/lib/storage/repos", () => {
  const repos = {
    plans: { save: vi.fn() },
    dishes: { list: mocks.listDishes, save: vi.fn() },
    houseRecipes: {},
    uid: null,
    loading: false,
  };
  return { useRepos: () => repos };
});
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
vi.mock("@/components/PlanWeekGrid", () => ({ default: () => <div /> }));
vi.mock("@/components/MacroSummary", () => ({ default: () => null }));
vi.mock("@/components/TargetAdherence", () => ({ default: () => null }));
vi.mock("@/components/SegmentedToggle", () => ({ default: () => null }));

const SLOTS = ["Breakfast", "Lunch", "Dinner"];

/** A realistic week: seven days, three meals each, every meal inline. */
const generated: GeneratedDay[] = Array.from({ length: 7 }, (_, day) => ({
  day,
  meals: SLOTS.map((slot, index) => ({
    slot,
    name: `${slot} ${day}`,
    items: [{ ingredientId: "chicken_breast_raw", name: "Chicken",
      grams: 100 + index, unitId: "g", quantity: 100 + index }],
    macros: { energy_kcal: 600, protein_g: 50, carbs_g: 60, fat_g: 20, fiber_g: 3 },
    price: { totalIdr: 50_000, complete: true, unpricedCount: 0 },
    kind: "ready" as const,
    dishStyle: "rice-bowl",
  })),
  macros: { energy_kcal: 1800, protein_g: 150, carbs_g: 180, fat_g: 60, fiber_g: 9 },
  price: { totalIdr: 150_000, complete: true, unpricedCount: 0 },
  unfilledSlots: [],
  adherence: { classification: "Within tolerance" },
})) as unknown as GeneratedDay[];

vi.mock("@/components/GeneratePlanDialog", () => ({
  default: ({ onApply }: {
    onApply: (days: GeneratedDay[], replace: boolean,
      preferences: unknown, resolvedTarget: MacroTargets,
      targetMode: "preset", targetPreset: "balanced") => Promise<boolean> | void;
  }) => (
    <button type="button" onClick={() =>
      void onApply(generated, true, { macroStyle: "balanced", proteinLean: [],
        avoidIngredientIds: [] }, RESOLVED, "preset", "balanced")}>
      apply generated week
    </button>
  ),
}));

import WeekPlanner from "@/components/WeekPlanner";

const planWithoutTargets = (): Plan => ({
  id: "primary", ownerUid: "", title: "August plan",
  createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
  targets: null, mealSlots: SLOTS, programStartDate: "2026-08-17",
  targetMode: "preset", targetPreset: "balanced",
  weekCount: 1, status: "draft", submittedWeeks: [],
  assignments: [{
    id: "week-2-keeper", week: 2, day: 0, slot: "Lunch", servings: 1,
    items: [], snapshot: { name: "Untouched week 2 meal",
      totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 } },
  }],
});

async function applyWeek(): Promise<void> {
  render(<WeekPlanner />);
  const open = await screen.findByText("Auto-fill my week");
  await act(async () => { fireEvent.click(open); });
  const apply = await screen.findByText("apply generated week");
  await act(async () => { fireEvent.click(apply); });
}

const savedPlan = (): Plan => mocks.savePlan.mock.calls.at(-1)?.[2] as Plan;

describe("applying a generated week", () => {
  beforeEach(() => {
    // vitest runs with `globals: false`, so testing-library's automatic
    // afterEach cleanup is not installed; without this each render stacks up
    // and every query finds several planners.
    cleanup();
    vi.clearAllMocks();
    mocks.listDishes.mockResolvedValue([]);
    mocks.loadCurrentPlan.mockResolvedValue(planWithoutTargets());
    mocks.savePlan.mockImplementation((_repo, _uid, plan: Plan) => Promise.resolve(plan));
  });

  it("persists every generated assignment, and the target it was generated against", async () => {
    await applyWeek();

    const saved = savedPlan();
    expect(saved).toBeDefined();
    expect(saved.targets).toEqual(RESOLVED);
    expect(saved.preferences).toMatchObject({ macroStyle: "balanced" });
    expect(saved).toMatchObject({ targetMode: "preset", targetPreset: "balanced" });

    const applied = saved.assignments.filter((a) => a.week === 1);
    expect(applied).toHaveLength(21);
    expect(new Set(applied.map((a) => a.day))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
    for (const assignment of applied) {
      expect(assignment.items?.length, assignment.snapshot.name).toBeGreaterThan(0);
      expect(assignment.snapshot.totals.energy_kcal).toBe(600);
      expect(assignment.price?.totalIdr).toBe(50_000);
    }
    // Replacing week 1 must not touch any other week.
    expect(saved.assignments.filter((a) => a.week === 2)).toHaveLength(1);
  });

  it("keeps the dialog open until the write lands", async () => {
    let release!: (plan: Plan) => void;
    mocks.savePlan.mockImplementation(() => new Promise<Plan>((resolve) => {
      release = resolve;
    }));

    render(<WeekPlanner />);
    const open = await screen.findByText("Auto-fill my week");
    await act(async () => { fireEvent.click(open); });
    const apply = await screen.findByText("apply generated week");
    await act(async () => { fireEvent.click(apply); });

    // Still open: the write has not been acknowledged, so the week is not saved.
    expect(screen.queryByText("apply generated week")).not.toBeNull();
    await act(async () => { release(planWithoutTargets()); });
    expect(screen.queryByText("apply generated week")).toBeNull();
  });

  it("says so when the save fails, and keeps the week on screen", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.savePlan.mockRejectedValue(new Error("offline"));

    await applyWeek();

    const alert = await screen.findByTestId("save-error");
    expect(alert.textContent).toMatch(/could not save your plan/i);
    // The dialog stays open, so the generated week is not lost to a failed write.
    expect(screen.queryByText("apply generated week")).not.toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("retries the save from the error banner", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.savePlan.mockRejectedValueOnce(new Error("offline"));

    await applyWeek();
    await screen.findByTestId("save-error");

    mocks.savePlan.mockImplementation((_repo, _uid, plan: Plan) => Promise.resolve(plan));
    await act(async () => { fireEvent.click(screen.getByText("Try again")); });

    expect(mocks.savePlan).toHaveBeenCalledTimes(2);
    expect(savedPlan().assignments.filter((a) => a.week === 1)).toHaveLength(21);
    expect(screen.queryByTestId("save-error")).toBeNull();
    consoleError.mockRestore();
  });
});
