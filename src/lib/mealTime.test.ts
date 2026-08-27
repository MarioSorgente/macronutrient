import { describe, expect, it } from "vitest";
import {
  archetypeForCourse,
  classifyCourse,
  mealTimesForCourse,
  resolveSlotProfiles,
  resolveSlotTime,
} from "@/lib/mealTime";
import { nutritionCatalog } from "@/lib/database";

/**
 * The bug this vocabulary exists to stop: a saved "Protein Banana Bread" was
 * classified a main, offered for lunch, and barred from breakfast — because the
 * regex that decided eligibility did not contain the words the *other* regex,
 * the one that only applied a 0.18 penalty, already knew.
 */

const recipe = (id: string) =>
  nutritionCatalog.menuRecipes.find((item) => item.recipe_id === id)!;

const courseOf = (id: string) => {
  const item = recipe(id);
  return classifyCourse({
    name: item.name,
    section: item.section,
    ingredients: item.components.map((component) => ({
      ingredientId: component.ingredient_id,
      grams: component.quantity_g ?? undefined,
    })),
  });
};

describe("classifyCourse over the real Negrita menu", () => {
  it("files every breakfast_and_sweets dish as sweet", () => {
    const sweets = nutritionCatalog.menuRecipes.filter(
      (item) => item.section === "breakfast_and_sweets"
    );
    expect(sweets.length).toBe(6);
    for (const item of sweets) {
      expect(courseOf(item.recipe_id), item.name).toBe("sweet");
    }
  });

  it("files every savoury main as a main", () => {
    const mains = [
      "bulking_chicken", "geisha", "chicken_pita", "thai_boy_beefy",
      "thai_boy_chicky", "buckwheat_bluefin_tuna", "buckwheat_chicken_teriyaki",
      "recovery_salmon", "bali_boy", "beef_ritual_burger", "peri_peri_chicken",
      "unagi_shogun", "greek_god_chicken", "greek_god_tenderloin",
      "greek_god_wagyu", "greek_god_salmon", "greek_god_scallops",
    ];
    for (const id of mains) expect(courseOf(id), id).toBe("main");
  });

  it("reads a breakfast burrito as savoury, so it is not banned from dinner", () => {
    // A breakfast burrito at dinner is unremarkable in a way a waffle is not.
    expect(courseOf("breakfast_protein_burrito")).toBe("breakfast-savoury");
    expect(mealTimesForCourse("breakfast-savoury")).toContain("dinner");
  });

  it("recognises a dessert by its anchor ingredient alone", () => {
    // Negrita's own loaf and syrniki are never a garnish, so their presence
    // settles it without a name or a section to go on.
    expect(classifyCourse({
      name: "Mystery slice",
      ingredients: [{ ingredientId: "banana_bread_negrita", grams: 120 }],
    })).toBe("sweet");
    expect(classifyCourse({
      name: "Mystery slice",
      ingredients: [{ ingredientId: "syrniki_negrita", grams: 100 }],
    })).toBe("sweet");
  });

  it("recognises a dessert by name when nothing else says so", () => {
    for (const name of ["Protein Banana Bread", "Special Protein Pancake",
      "Protein Bountiful Fruit Waffle", "Cheese Cake", "Granola bowl",
      "Acai bowl", "Porridge", "Crêpes", "Overnight oats"]) {
      expect(classifyCourse({ name }), name).toBe("sweet");
    }
  });
});

describe("sweetness is dominance, not presence", () => {
  it("does not call honey-glazed chicken a dessert", () => {
    // Twenty grams of honey on a chicken breast is a glaze. Banning that plate
    // from dinner would be the same category error in the other direction.
    expect(classifyCourse({
      name: "Grilled chicken with honey glaze",
      ingredients: [
        { ingredientId: "chicken_breast_raw", grams: 250 },
        { ingredientId: "honey", grams: 20 },
      ],
    })).toBe("main");
  });

  it("does not call an avocado plate a dessert", () => {
    // Avocado is filed as fruit and is on half the savoury menu.
    expect(classifyCourse({
      name: "Chicken and avocado plate",
      ingredients: [
        { ingredientId: "chicken_breast_raw", grams: 200 },
        { ingredientId: "avocado_raw", grams: 100 },
      ],
    })).toBe("main");
  });

  it("calls a plate that is mostly fruit and honey sweet", () => {
    expect(classifyCourse({
      name: "Morning plate",
      ingredients: [
        { ingredientId: "banana_raw", grams: 200 },
        { ingredientId: "honey", grams: 40 },
        { ingredientId: "egg_white_raw", grams: 30 },
      ],
    })).toBe("sweet");
  });
});

describe("mealTimesForCourse", () => {
  it("keeps sweets to breakfast — not lunch, dinner or snack", () => {
    expect(mealTimesForCourse("sweet")).toEqual(["breakfast"]);
  });

  it("maps courses onto the archetypes the planner counts variety with", () => {
    expect(archetypeForCourse("sweet")).toBe("breakfast");
    expect(archetypeForCourse("breakfast-savoury")).toBe("breakfast");
    expect(archetypeForCourse("main")).toBe("main");
  });
});

describe("resolveSlotTime", () => {
  it("reads the ordinary names", () => {
    expect(resolveSlotTime("Breakfast", 0, 4).mealTime).toBe("breakfast");
    expect(resolveSlotTime("Lunch", 1, 4).mealTime).toBe("lunch");
    expect(resolveSlotTime("Dinner", 2, 4).mealTime).toBe("dinner");
    expect(resolveSlotTime("Snack", 3, 4).mealTime).toBe("snack");
  });

  it("reads brunch as breakfast", () => {
    expect(resolveSlotTime("Weekend brunch", 0, 3).mealTime).toBe("breakfast");
  });

  it("infers an unrecognised name from its position in the day", () => {
    // "Meal 1" used to mean dinner, which both admitted every dinner main and
    // barred every breakfast dish from the morning slot.
    const day = resolveSlotProfiles(["Meal 1", "Meal 2", "Meal 3"]);
    expect(day.map((entry) => entry.mealTime)).toEqual([
      "breakfast", "lunch", "dinner",
    ]);
    expect(day.every((entry) => entry.inferred)).toBe(true);
  });

  it("splits two unnamed slots into the ends of the day", () => {
    expect(resolveSlotProfiles(["Primo", "Secondo"]).map((s) => s.mealTime))
      .toEqual(["breakfast", "dinner"]);
  });

  it("leaves a lone unnamed slot unrestricted", () => {
    // It stands for the whole day: there is no wrong time to be wrong about,
    // and refusing a dish would leave the only slot empty.
    expect(resolveSlotProfiles(["Meal"])[0].unrestricted).toBe(true);
  });

  it("restricts a lone slot that names itself", () => {
    expect(resolveSlotProfiles(["Breakfast"])[0].unrestricted).toBe(false);
  });

  it("restricts every slot once there is more than one", () => {
    expect(resolveSlotProfiles(["Meal 1", "Meal 2"]).every((s) => !s.unrestricted))
      .toBe(true);
  });

  it("marks a recognised name as not inferred", () => {
    expect(resolveSlotTime("Breakfast", 2, 4).inferred).toBe(false);
  });

  it("mixes named and positional slots without disturbing the named ones", () => {
    const day = resolveSlotProfiles(["Wake up", "Lunch", "Evening"]);
    expect(day.map((entry) => entry.mealTime)).toEqual([
      "breakfast", "lunch", "dinner",
    ]);
  });
});
