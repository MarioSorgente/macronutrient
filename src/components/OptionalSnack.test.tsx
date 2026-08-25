// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedDay, GeneratedPlan } from "@/lib/mealPlanner";
import type { Dish, Plan } from "@/lib/storage/types";

/**
 * A day the planner deliberately finished in three meals has to read as a
 * complete day everywhere it is shown.
 *
 * The generator can now leave an optional slot out when the day reaches its
 * macros without it. The screens it lands on judged a day complete only when
 * every slot held something, so the same day the preview called "Within
 * tolerance" came back as "No plan" the moment it was saved — and an empty
 * Snack row read as a failure rather than as a choice.
 */

const mocks = vi.hoisted(() => ({ generatePlanWithTargets: vi.fn() }));

vi.mock("@/lib/mealPlanner", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mealPlanner")>(
    "@/lib/mealPlanner"
  );
  return { ...actual, generatePlanWithTargets: mocks.generatePlanWithTargets };
});

import GeneratePlanDialog from "@/components/GeneratePlanDialog";
import PlanWeekGrid from "@/components/PlanWeekGrid";

const SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];
const TARGETS = { energy_kcal: 2000, protein_g: 125, carbs_g: 225, fat_g: 66.7 };
const MEAL_MACROS = { energy_kcal: 666.7, protein_g: 41.7, carbs_g: 75, fat_g: 22.2, fiber_g: 3 };
const DAY_MACROS = { energy_kcal: 2000, protein_g: 125, carbs_g: 225, fat_g: 66.7, fiber_g: 9 };

const threeMealDay = (overrides: Partial<GeneratedDay> = {}): GeneratedDay => ({
  day: 0,
  meals: ["Breakfast", "Lunch", "Dinner"].map((slot) => ({
    slot,
    name: `${slot} plate`,
    items: [{ ingredientId: "chicken_breast_raw", name: "Chicken", grams: 100,
      unitId: "g", quantity: 100 }],
    macros: MEAL_MACROS,
    price: { totalIdr: 50_000, complete: true, unpricedCount: 0 },
    kind: "ready" as const,
    dishStyle: "rice-bowl",
  })),
  macros: DAY_MACROS,
  price: { totalIdr: 150_000, complete: true, unpricedCount: 0 },
  unfilledSlots: [],
  skippedSlots: ["Snack"],
  ...overrides,
} as unknown as GeneratedDay);

const generatedPlan = (day: GeneratedDay): GeneratedPlan => ({
  days: [day],
  resolvedTarget: TARGETS,
  targetSource: "explicit",
  targetStyle: "Balanced",
  targetExplanation: "As entered.",
} as unknown as GeneratedPlan);

const plan = (): Plan => ({
  id: "primary", ownerUid: "", title: "August plan",
  createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
  targets: TARGETS, mealSlots: SLOTS, programStartDate: "2026-08-17",
  weekCount: 1, status: "draft", submittedWeeks: [],
  // No item list, so the saved snapshot is what the grid totals — three meals
  // that add up to the day's targets exactly.
  assignments: ["Breakfast", "Lunch", "Dinner"].map((slot) => ({
    id: `mon-${slot}`, week: 1, day: 0, slot, servings: 1,
    price: { totalIdr: 50_000, complete: true },
    snapshot: { name: `${slot} plate`, totals: MEAL_MACROS },
  })),
});

// vitest runs with `globals: false`, so testing-library's automatic cleanup is
// not installed and renders would otherwise stack up.
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the week grid", () => {
  it("does not call a saved day incomplete for going without a snack", () => {
    render(
      <PlanWeekGrid
        plan={plan()}
        week={1}
        dishes={new Map<string, Dish>()}
        showPrices={false}
        onOpenMeal={() => {}}
        onAddMeal={() => {}}
      />
    );

    // Monday holds three meals and hits its targets, so it is a complete day.
    // The other six are genuinely empty and still say so.
    expect(screen.getAllByText("All macros OK")).toHaveLength(1);
    expect(screen.getAllByText("Incomplete day")).toHaveLength(6);
  });
});

describe("the generator preview", () => {
  const generate = (day: GeneratedDay) => {
    mocks.generatePlanWithTargets.mockReturnValue(generatedPlan(day));
    render(
      <GeneratePlanDialog plan={plan()} week={1} savedDishes={[]}
        onApply={() => {}} onClose={() => {}} />
    );
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Generate"));
  };

  it("says the day went without a snack, rather than that a slot failed", () => {
    generate(threeMealDay());

    expect(screen.getByText(/No Snack/)).toBeTruthy();
    expect(screen.getByText(/reaches\s+its target without one/)).toBeTruthy();
    expect(screen.queryByText(/Could not fill/)).toBeNull();
  });

  it("still reports a slot it genuinely could not fill", () => {
    generate(threeMealDay({ skippedSlots: [], unfilledSlots: ["Snack"] }));

    expect(screen.getByText(/Could not fill Snack/)).toBeTruthy();
    expect(screen.queryByText(/No Snack/)).toBeNull();
  });
});
