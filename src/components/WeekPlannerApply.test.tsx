// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Plan, MacroTargets } from "@/lib/storage/types";
import type { GeneratedDay } from "@/lib/mealPlanner";

/**
 * Applying a generated week has to persist the target it was generated against.
 * A plan created from "Auto → Balanced 2000 kcal" used to save with
 * `targets: null`, so the preview measured the week against 2000 kcal and the
 * plan it produced measured it against nothing at all.
 */

const RESOLVED: MacroTargets = {
  energy_kcal: 2000, protein_g: 125, carbs_g: 225, fat_g: 66.66666666666667,
};

const mocks = vi.hoisted(() => ({
  loadCurrentPlan: vi.fn(),
  listDishes: vi.fn(),
  savePlan: vi.fn(),
}));

vi.mock("@/lib/currentPlan", () => ({ loadCurrentPlan: mocks.loadCurrentPlan }));
vi.mock("@/lib/storage/repos", () => {
  const repos = {
    plans: { save: mocks.savePlan },
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

const generated: GeneratedDay[] = [{
  day: 0,
  meals: [{
    slot: "Lunch",
    name: "Geisha",
    items: [{ ingredientId: "chicken_breast_raw", name: "Chicken", grams: 150,
      unitId: "g", quantity: 150 }],
    macros: { energy_kcal: 580, protein_g: 80, carbs_g: 62, fat_g: 5, fiber_g: 2 },
    price: { totalIdr: 99_000, complete: true, unpricedCount: 0 },
    kind: "ready",
  }],
  macros: { energy_kcal: 580, protein_g: 80, carbs_g: 62, fat_g: 5, fiber_g: 2 },
  price: { totalIdr: 99_000, complete: true, unpricedCount: 0 },
  unfilledSlots: [],
  adherence: { classification: "Within tolerance" },
} as unknown as GeneratedDay];

vi.mock("@/components/GeneratePlanDialog", () => ({
  default: ({ onApply }: {
    onApply: (days: GeneratedDay[], replace: boolean,
      preferences: unknown, resolvedTarget: MacroTargets) => void;
  }) => (
    <button type="button" onClick={() =>
      onApply(generated, true, { macroStyle: "balanced", proteinLean: [],
        avoidIngredientIds: [] }, RESOLVED)}>
      apply generated week
    </button>
  ),
}));

import WeekPlanner from "@/components/WeekPlanner";

const planWithoutTargets: Plan = {
  id: "plan-1", ownerUid: "", title: "August plan",
  createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
  targets: null, mealSlots: ["Lunch"], programStartDate: "2026-08-17",
  weekCount: 1, status: "draft", submittedWeeks: [], assignments: [],
};

describe("applying a generated week", () => {
  it("persists the derived target the week was generated against", async () => {
    mocks.listDishes.mockResolvedValue([]);
    mocks.loadCurrentPlan.mockResolvedValue(planWithoutTargets);
    mocks.savePlan.mockResolvedValue(undefined);

    render(<WeekPlanner />);
    const open = await screen.findByText("Auto-fill my week");
    await act(async () => { fireEvent.click(open); });
    const apply = await screen.findByText("apply generated week");
    await act(async () => { fireEvent.click(apply); });

    const saved = mocks.savePlan.mock.calls.at(-1)?.[0] as Plan;
    expect(saved).toBeDefined();
    expect(saved.targets).toEqual(RESOLVED);
    expect(saved.assignments).toHaveLength(1);
    expect(saved.assignments[0].snapshot.name).toBe("Geisha");
  });
});
