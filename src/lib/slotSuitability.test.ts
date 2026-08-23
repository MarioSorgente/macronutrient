import { describe, expect, it } from "vitest";
import {
  ingredientSlotPenalty,
  mealSlotEligibility,
  mealSlotPenalty,
  namedDishSlotPenalty,
  slotKindOf,
} from "@/lib/slotSuitability";

describe("slotKindOf", () => {
  it("recognises the slots people actually name", () => {
    expect(slotKindOf("Breakfast")).toBe("breakfast");
    expect(slotKindOf("Brunch")).toBe("breakfast");
    expect(slotKindOf("Snack")).toBe("snack");
    expect(slotKindOf("Post-workout")).toBe("snack");
    expect(slotKindOf("Lunch")).toBe("main");
    expect(slotKindOf("Dinner")).toBe("main");
  });
});

describe("breakfast suitability", () => {
  it("keeps eligibility independent of a suggested protein allocation", () => {
    const result = mealSlotEligibility({
      slot: "Breakfast",
      mealArchetype: "breakfast",
      eligibleMealTypes: ["breakfast"],
      ingredients: [{ ingredientId: "egg_whole_hard_boiled", grams: 300 }],
    });
    expect(result).toEqual({ allowed: true, reason: "ELIGIBLE_CLASSIFIED_SLOT" });
  });

  it("forbids a chicken plate even when its macros might improve the day", () => {
    expect(mealSlotEligibility({
      slot: "Breakfast",
      ingredients: [{ ingredientId: "chicken_peri_peri_negrita", grams: 300 }],
      name: "Peri-peri chicken plate",
    })).toMatchObject({ allowed: false, reason: "INELIGIBLE_BREAKFAST_MAIN" });
  });

  it("penalises a saucy dinner protein at breakfast", () => {
    // The complaint that prompted this: peri peri chicken at 8am.
    const peri = ingredientSlotPenalty("chicken_peri_peri_negrita", "breakfast");
    const eggs = ingredientSlotPenalty("egg_whole_hard_boiled", "breakfast");
    expect(peri).toBeGreaterThan(0);
    expect(eggs).toBeLessThan(0);
    expect(peri).toBeGreaterThan(eggs);
  });

  it("prefers eggs and toast over steak and broccoli", () => {
    const proper = mealSlotPenalty(
      ["egg_whole_hard_boiled", "bread_sourdough", "avocado_raw"],
      "Breakfast"
    );
    const dinner = mealSlotPenalty(
      ["beef_tenderloin_raw", "broccoli_boiled", "tzatziki_proxy"],
      "Breakfast"
    );
    expect(proper).toBeLessThan(dinner);
  });

  it("leaves rice neutral — a Bali breakfast is not a European one", () => {
    // Deliberately not penalised: rice at breakfast is normal here, the rule is
    // about heaviness and sauciness rather than about imposing a cuisine.
    const rice = ingredientSlotPenalty("rice_jasmine_cooked_proxy", "breakfast");
    const peri = ingredientSlotPenalty("chicken_peri_peri_negrita", "breakfast");
    expect(rice).toBeLessThan(peri);
  });

  it("does not punish a whole meal for one questionable component", () => {
    // Averaged, not summed: three good items and one odd one should still beat
    // a meal that is wrong throughout.
    const mostlyRight = mealSlotPenalty(
      ["egg_whole_hard_boiled", "bread_sourdough", "avocado_raw", "broccoli_boiled"],
      "Breakfast"
    );
    const wrongThroughout = mealSlotPenalty(
      ["beef_tenderloin_raw", "chicken_peri_peri_negrita"],
      "Breakfast"
    );
    expect(mostlyRight).toBeLessThan(wrongThroughout);
  });
});

describe("main meals and snacks", () => {
  it("allows a light snack regardless of the remaining carb shortage", () => {
    expect(mealSlotEligibility({
      slot: "Snack",
      mealArchetype: "snack",
      eligibleMealTypes: ["snack", "post-workout"],
      ingredients: [{ ingredientId: "banana_raw", grams: 100 }],
    })).toMatchObject({ allowed: true, reason: "ELIGIBLE_CLASSIFIED_SLOT" });
  });

  it("allows compatible plates at both lunch and dinner", () => {
    const plate = [{ ingredientId: "chicken_breast_raw", grams: 300 }];
    expect(mealSlotEligibility({ slot: "Lunch", ingredients: plate }).allowed).toBe(true);
    expect(mealSlotEligibility({ slot: "Dinner", ingredients: plate }).allowed).toBe(true);
  });

  it("mildly discourages breakfast food as a main course", () => {
    expect(ingredientSlotPenalty("bread_brioche", "main")).toBeGreaterThan(0);
    // ...but only mildly: it must not outweigh hitting the macro target.
    expect(ingredientSlotPenalty("bread_brioche", "main")).toBeLessThan(0.3);
  });

  it("keeps a knife-and-fork main out of a snack slot", () => {
    expect(ingredientSlotPenalty("beef_tenderloin_raw", "snack")).toBeGreaterThan(0);
    expect(ingredientSlotPenalty("greek_yogurt_nonfat", "snack")).toBe(0);
  });
});

describe("named dishes", () => {
  it("reads the name when there is no component list to inspect", () => {
    expect(namedDishSlotPenalty("Wagyu Kofta Delhi", "Breakfast")).toBeGreaterThan(0);
    expect(namedDishSlotPenalty("Scrambled eggs on toast", "Breakfast")).toBeLessThan(0);
  });

  it("scores an unremarkable name as neutral rather than wrong", () => {
    const penalty = namedDishSlotPenalty("Bali Boy", "Breakfast");
    expect(penalty).toBeGreaterThan(0);
    expect(penalty).toBeLessThan(
      namedDishSlotPenalty("Peri Peri Chicken Plate", "Breakfast")
    );
  });
});
