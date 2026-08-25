// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedDay, GeneratedPlan } from "@/lib/mealPlanner";
import { diagnoseDailyAdherence } from "@/lib/dailyAdherence";
import type { Dish, Plan } from "@/lib/storage/types";

/**
 * Two things the generator now says that it used to leave the reader to guess.
 *
 * A day it deliberately finished in three meals is a complete day, and has to
 * read as one everywhere: the screens judged a day complete only when every
 * slot held something, so the same day the preview called "Within tolerance"
 * came back as "No plan" the moment it was saved, and an empty Snack row read
 * as a failure rather than as a choice.
 *
 * And a week where no day adheres is not seven bad answers — it is a target
 * this menu cannot assemble. Above roughly 3,600 kcal on four slots nothing
 * reaches the number, the largest breakfast lands closest every time, and the
 * result was seven identical mornings with nothing on screen explaining why.
 */

const mocks = vi.hoisted(() => ({ generatePlanWithTargets: vi.fn() }));

vi.mock("@/lib/mealPlanner", async (original) => ({
  ...await original<typeof import("@/lib/mealPlanner")>(),
  generatePlanWithTargets: (options: never) => mocks.generatePlanWithTargets(options),
}));
vi.mock("@/components/IngredientTypeahead", () => ({ default: () => null }));

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
  // Diagnosed for real, from the macros above, so the fixture cannot claim an
  // adherence the numbers do not support.
  adherence: diagnoseDailyAdherence(
    (overrides.macros ?? DAY_MACROS) as GeneratedDay["macros"], TARGETS, { complete: true }),
  ...overrides,
} as unknown as GeneratedDay);

const generatedPlan = (days: GeneratedDay[]): GeneratedPlan => ({
  days,
  resolvedTarget: TARGETS,
  targetSource: "explicit",
  targetStyle: "Explicit",
  targetExplanation: "As entered.",
} as unknown as GeneratedPlan);

const plan = (): Plan => ({
  id: "primary", ownerUid: "", title: "August plan",
  createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
  targets: TARGETS, targetMode: "custom", mealSlots: SLOTS,
  programStartDate: "2026-08-17",
  weekCount: 1, status: "draft", submittedWeeks: [],
  // No item list, so the saved snapshot is what the grid totals — three meals
  // that add up to the day's targets exactly.
  assignments: ["Breakfast", "Lunch", "Dinner"].map((slot) => ({
    id: `mon-${slot}`, week: 1, day: 0, slot, servings: 1,
    price: { totalIdr: 50_000, complete: true },
    snapshot: { name: `${slot} plate`, totals: MEAL_MACROS },
  })),
} as unknown as Plan);

// vitest runs with `globals: false`, so testing-library's automatic cleanup is
// not installed and renders would otherwise stack up.
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

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
    expect(screen.getAllByText("Within target")).toHaveLength(1);
    expect(screen.getAllByText("Incomplete day")).toHaveLength(6);
  });
});

describe("the generator preview", () => {
  const generate = async (days: GeneratedDay[]) => {
    vi.useFakeTimers();
    mocks.generatePlanWithTargets.mockReturnValue(generatedPlan(days));
    render(
      <GeneratePlanDialog plan={plan()} week={1} savedDishes={[]}
        onApply={() => {}} onTargetsSave={() => {}} onClose={() => {}} />
    );
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    await act(() => vi.runAllTimersAsync());
  };

  it("says the day went without a snack, rather than that a slot failed", async () => {
    await generate([threeMealDay()]);

    expect(screen.getByText(/No Snack/)).toBeTruthy();
    expect(screen.getByText(/reaches\s+its target without one/)).toBeTruthy();
    expect(screen.queryByText(/Could not fill/)).toBeNull();
  });

  it("still reports a slot it genuinely could not fill", async () => {
    await generate([threeMealDay({ skippedSlots: [], unfilledSlots: ["Snack"] })]);

    expect(screen.getByText(/Could not fill Snack/)).toBeTruthy();
    expect(screen.queryByText(/No Snack/)).toBeNull();
  });

  it("leaves a week that misses its target to the days themselves", async () => {
    // Three days short of the same 2,000 kcal. There is no week-level warning
    // strip any more: each day says what it is in its own adherence badge, and
    // saying it again above the list only made the same point louder.
    const short = (day: number, kcal: number) =>
      threeMealDay({ day, macros: { ...DAY_MACROS, energy_kcal: kcal } });
    await generate([short(0, 1_640), short(1, 1_666), short(2, 1_655)]);

    expect(screen.queryByTestId("target-unreachable")).toBeNull();
    expect(screen.queryByText(/No day on this menu reaches/)).toBeNull();
    // The days are still there, and still honest about themselves.
    expect(screen.getAllByText(/Out:/).length).toBeGreaterThan(0);
  });
});
