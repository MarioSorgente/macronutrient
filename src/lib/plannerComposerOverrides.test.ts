import { afterEach, describe, expect, it } from "vitest";
import { __diyLinesForTests } from "@/lib/plannerComposer";
import {
  getIngredient,
  houseOverridesVersion,
  setHouseOverrides,
} from "@/lib/database";
import type { Macros } from "@/types/nutrition";

/**
 * House recipes reach the planner late.
 *
 * They are read from Firestore after the planner has already rendered, and the
 * owner can edit one at any time. The composer caches its DIY lines, and those
 * lines hold resolved `Ingredient` objects with the override already folded in
 * — so a cache built once went on composing every build-your-own meal from the
 * bundled estimate for the rest of the session, including immediately after the
 * owner corrected the recipe.
 */

afterEach(() => setHouseOverrides(new Map()));

/** A DIY line whose ingredient is a house item the restaurant can redefine. */
function houseLine() {
  return __diyLinesForTests().find((line) =>
    line.ingredient.source_status === "estimated_online_proxy" ||
    line.ingredient.source_status === "estimated_formula"
  );
}

const OVERRIDE: Macros = {
  energy_kcal: 999,
  protein_g: 99,
  carbs_g: 9,
  fat_g: 0.9,
  fiber_g: 0.09,
};

describe("house overrides reaching the composer", () => {
  it("bumps a version whenever the overrides change", () => {
    const before = houseOverridesVersion();
    setHouseOverrides(new Map());
    expect(houseOverridesVersion()).toBe(before + 1);
  });

  it("rebuilds the DIY lines after a house recipe arrives", () => {
    const line = houseLine();
    // The bundled catalog always ships house items; if that ever stops being
    // true this test is not silently passing on an empty search.
    expect(line).toBeTruthy();
    const id = line!.ingredient.ingredient_id;
    expect(line!.ingredient.macros_per_100g.energy_kcal).not.toBe(
      OVERRIDE.energy_kcal
    );

    setHouseOverrides(new Map([[id, OVERRIDE]]));

    const updated = __diyLinesForTests().find(
      (entry) => entry.ingredient.ingredient_id === id
    );
    expect(updated?.ingredient.macros_per_100g).toEqual(OVERRIDE);
    expect(updated?.ingredient.source_status).toBe("negrita_recipe");
    // The same value the rest of the app would read for that ingredient.
    expect(getIngredient(id)?.macros_per_100g).toEqual(OVERRIDE);
  });

  it("drops back to the bundled estimate when a recipe is removed", () => {
    const line = houseLine()!;
    const id = line.ingredient.ingredient_id;
    const bundled = line.ingredient.macros_per_100g;

    setHouseOverrides(new Map([[id, OVERRIDE]]));
    setHouseOverrides(new Map());

    const reverted = __diyLinesForTests().find(
      (entry) => entry.ingredient.ingredient_id === id
    );
    expect(reverted?.ingredient.macros_per_100g).toEqual(bundled);
  });

  it("still caches while the overrides hold still", () => {
    // The cache is worth keeping; only staleness was the problem.
    expect(__diyLinesForTests()).toBe(__diyLinesForTests());
  });
});
