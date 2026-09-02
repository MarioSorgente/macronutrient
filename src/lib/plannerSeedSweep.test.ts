import { describe, expect, it } from "vitest";
import {
  generatePlanWithTargets,
  prepareGeneration,
  planFromPrepared,
  seedSweep,
  InvalidMacroTargetError,
} from "@/lib/mealPlanner";
import { DEFAULT_PREFERENCES, type MacroTargets } from "@/lib/storage/types";

/**
 * The seed hoist has to be invisible.
 *
 * Shuffle used to call the whole generator once per candidate, and the whole
 * generator is roughly fifty beam searches. The seed reaches exactly one line of
 * it — the tie-break between finalist weeks — so the search can be prepared once
 * and swept. That is only a safe trade if the weeks that come back are the same
 * weeks, which is what this asserts: for a spread of seeds, the hoisted path is
 * deep-equal to calling the untouched public entry point.
 *
 * If a future change makes any part of the search read the seed, these fail.
 */

const TARGETS: MacroTargets = {
  energy_kcal: 2200,
  protein_g: 160,
  carbs_g: 220,
  fat_g: 70,
};

const options = (seed: number) => ({
  days: [0, 1, 2, 3, 4, 5, 6],
  slots: ["Breakfast", "Lunch", "Dinner", "Snack"],
  targets: TARGETS,
  savedDishes: [],
  includeSavedDishes: false,
  includeMenuDishes: true,
  includeComposed: true,
  dailyBudgetIdr: null,
  preferences: DEFAULT_PREFERENCES,
  seed,
}) as Parameters<typeof generatePlanWithTargets>[0];

const SEEDS = [1, 2, 3, 5, 8, 13];

describe("preparing the search once and sweeping seeds", () => {
  it("returns exactly the week the unhoisted generator returns, for every seed", () => {
    const prepared = prepareGeneration(options(1));

    for (const seed of SEEDS) {
      expect(
        planFromPrepared(prepared, options(seed), seed),
        `seed ${seed}`
      ).toEqual(generatePlanWithTargets(options(seed)));
    }
  });

  it("agrees with itself across a sweep, so preparation carries no state between seeds", () => {
    const sweep = seedSweep(options(1));
    // Reversed, because a cache warmed by an earlier seed must not change a
    // later one. Running the sweep in a different order proves that.
    for (const seed of [...SEEDS].reverse()) {
      expect(sweep(seed), `seed ${seed}`).toEqual(generatePlanWithTargets(options(seed)));
    }
  });

  it("still validates the target before doing any work", () => {
    const contradictory = { energy_kcal: 4000, protein_g: 175, carbs_g: 175, fat_g: 66.7 };
    expect(() => prepareGeneration({ ...options(1), targets: contradictory }))
      .toThrowError(InvalidMacroTargetError);
  });
});
