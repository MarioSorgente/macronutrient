import { describe, expect, it, vi } from "vitest";
import { meaningfulDifference, normalizedMealIdentity, searchShuffleAlternatives } from "@/lib/plannerShuffle";
import type { GenerateOptions, GeneratedPlan } from "@/lib/mealPlanner";
import { DEFAULT_PREFERENCES } from "@/lib/storage/types";

const generation: GenerateOptions = {
  targets: { energy_kcal: 100, protein_g: 10, carbs_g: 10, fat_g: 2 },
  slots: ["Lunch"], includeMenuDishes: true, includeSavedDishes: false,
  savedDishes: [], preferences: DEFAULT_PREFERENCES, dailyBudgetIdr: 100, days: [0],
};

function plan(id: string, price = 50, classification = "Exact"): GeneratedPlan {
  const macros = { ...generation.targets!, fiber_g: 1 };
  const priceResult = { totalIdr: price, unpricedCount: 0, complete: true };
  return {
    resolvedTarget: generation.targets!, targetSource: "explicit", targetStyle: "Explicit", targetExplanation: "test",
    days: [{ day: 0, unfilledSlots: [], skippedSlots: [], macros, price: priceResult,
      adherence: { classification, compliant: true, fields: {} } as never,
      meals: [{ slot: "Lunch", name: `${id} 150 g`, sourceDishId: id, kind: "ready", dishStyle: id,
        items: [{ ingredientId: id, name: id, grams: 150, unitId: "g", quantity: 150 }],
        macros, price: priceResult }] }],
  };
}

describe("bounded shuffle search", () => {
  it("uses normalized identities rather than portion-adjusted names", () => {
    const meal = plan("chicken").days[0].meals[0];
    expect(normalizedMealIdentity({ ...meal, name: "Chicken 225 g" })).toBe(normalizedMealIdentity(meal));
    expect(meaningfulDifference(plan("chicken"), plan("chicken"))).toBe(0);
  });

  it("tells two Negrita dishes apart by the dish, not by their parts", () => {
    const base = plan("chicken").days[0].meals[0];
    const pancake = { ...base, menuRecipeId: "special_protein_pancake" };
    const waffle = { ...base, menuRecipeId: "protein_bountiful_fruit_waffle" };

    // Identical ingredient lists here on purpose: a menu dish is the dish it
    // is, and deriving that from its components only held while no two dishes
    // shared a set of them.
    expect(normalizedMealIdentity(pancake)).not.toBe(normalizedMealIdentity(waffle));
    expect(normalizedMealIdentity(pancake)).toBe("menu:special_protein_pancake");
    // And a composed plate of the same ingredients is still a different meal.
    expect(normalizedMealIdentity(base)).not.toBe(normalizedMealIdentity(pancake));
  });

  it("checks a deterministic bound without relying on wall-clock time", async () => {
    let tick = 0;
    const forSeed = vi.fn((seed: number) => plan(`meal-${seed}`));
    const generate = vi.fn((_: GenerateOptions) => forSeed);
    const result = await searchShuffleAlternatives({ current: plan("original"), generation, firstSeed: 2,
      generate, maxCandidates: 100, maxDurationMs: 5, now: () => tick++, yieldToBrowser: async () => {} });
    expect(result.evaluated).toBeLessThanOrEqual(4);
    expect(forSeed).toHaveBeenCalledTimes(result.evaluated);
    // The seed-independent search is prepared once, however many seeds are tried.
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("cancels between candidates and rejects changed adherence, exclusions, and budget", async () => {
    const controller = new AbortController();
    let calls = 0;
    const generate = (_: GenerateOptions) => (seed: number) => {
      calls += 1;
      if (calls === 1) return plan("new", 50, "Within tolerance");
      if (calls === 2) return plan("forbidden");
      controller.abort();
      return plan(`meal-${seed}`, 101);
    };
    const result = await searchShuffleAlternatives({ current: plan("original"),
      generation: { ...generation, preferences: { ...DEFAULT_PREFERENCES, avoidIngredientIds: ["forbidden"] } },
      firstSeed: 2, generate, signal: controller.signal, yieldToBrowser: async () => {} });
    expect(result.changed).toBe(false);
    expect(result.plan).toEqual(plan("original"));
    expect(calls).toBe(3);
  });

  it("supports repeated shuffles and deterministic seed tie-breaking", async () => {
    const generate = (_: GenerateOptions) => (seed: number) => plan(seed % 2 ? "odd" : "even");
    const first = await searchShuffleAlternatives({ current: plan("original"), generation,
      firstSeed: 10, generate, maxCandidates: 4, yieldToBrowser: async () => {} });
    const second = await searchShuffleAlternatives({ current: first.plan, generation,
      firstSeed: first.seed + 1, generate, maxCandidates: 4, yieldToBrowser: async () => {} });
    expect(first.seed).toBe(10);
    expect(second.changed).toBe(true);
    expect(second.seed).toBe(11);
  });
});
