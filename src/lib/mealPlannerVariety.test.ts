import { describe, expect, it } from "vitest";
import { generatePlan, generatePlanWithTargets, type GeneratedDay } from "@/lib/mealPlanner";
import { menuRecipes } from "@/lib/database";
import { negritaMenuCandidate } from "@/lib/plannerCandidates";
import { NEGRITA_PLANNER_METADATA } from "@/lib/negritaPlannerMetadata";
import { DEFAULT_PREFERENCES, type MacroTargets } from "@/lib/storage/types";

/**
 * Week-level regression cover, run against the real Negrita catalog rather than
 * synthetic fixtures that already add up to the target. Fixture days prove the
 * search obeys its own rules; only the real menu proves the planner produces a
 * week somebody would actually eat.
 */

const SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];
const WEEK = [0, 1, 2, 3, 4, 5, 6];

/**
 * Generation is deterministic, so identical requests are cached: several
 * assertions here look at the same week from different angles, and regenerating
 * it each time only slows the suite down.
 */
const generated = new Map<string, GeneratedDay[]>();

function week(targets: MacroTargets, overrides: Record<string, unknown> = {}): GeneratedDay[] {
  const key = JSON.stringify([targets, overrides]);
  const hit = generated.get(key);
  if (hit) return hit;
  const days = generatePlan({
    days: WEEK, slots: SLOTS, targets, savedDishes: [], includeSavedDishes: false,
    includeMenuDishes: true, includeComposed: true, dailyBudgetIdr: null,
    preferences: DEFAULT_PREFERENCES, seed: 1, ...overrides,
  } as Parameters<typeof generatePlan>[0]);
  generated.set(key, days);
  return days;
}

const inSlot = (days: GeneratedDay[], index: number) =>
  days.map((day) => day.meals[index]?.name ?? "");
const distinct = (values: string[]) => new Set(values).size;
const mostRepeated = (values: string[]) =>
  Math.max(...[...new Set(values)].map((value) =>
    values.filter((other) => other === value).length));
const consecutive = (values: string[]) =>
  values.filter((value, index) => index > 0 && values[index - 1] === value);

const HIGH_PROTEIN: MacroTargets = {
  energy_kcal: 2000, protein_g: 175, carbs_g: 175, fat_g: 66.7,
};
const BALANCED: MacroTargets = {
  energy_kcal: 2000, protein_g: 125, carbs_g: 225, fat_g: 66.7,
};

const BALANCED_4000: MacroTargets = {
  energy_kcal: 4000, protein_g: 250, carbs_g: 450, fat_g: 4000 * 0.3 / 9,
};

describe("weekly variety on the real menu", () => {
  it("produces seven visibly different days", () => {
    const days = week(HIGH_PROTEIN);
    const signatures = days.map((day) => day.meals.map((meal) => meal.name).join(" | "));
    const everything = days.flatMap((day) => day.meals.map((meal) => meal.name));

    expect(days).toHaveLength(7);
    expect(distinct(signatures), "no two identical days").toBe(7);
    expect(distinct(everything)).toBeGreaterThanOrEqual(12);
    for (const day of days) {
      expect(day.meals).toHaveLength(SLOTS.length);
      expect(day.adherence.classification).not.toBe("Impossible");
    }
  });

  it.each([0, 1, 2, 3])("varies slot %i across the week and never repeats it on adjacent days", (index) => {
    const names = inSlot(week(HIGH_PROTEIN), index);
    expect(distinct(names), `distinct choices for ${SLOTS[index]}`).toBeGreaterThanOrEqual(4);
    expect(mostRepeated(names), `most repeated ${SLOTS[index]}`).toBeLessThanOrEqual(3);
    expect(consecutive(names), `${SLOTS[index]} repeated on consecutive days`).toEqual([]);
  });

  it("does not let the Breakfast Protein Burrito become the default breakfast", () => {
    const breakfasts = inSlot(week(HIGH_PROTEIN), 0);
    const burrito = breakfasts.filter((name) => /Breakfast Protein Burrito/i.test(name));

    // It is a real breakfast on the menu, so it is not banned — only stopped
    // from taking every morning, which is what the flat repeat penalty allowed.
    expect(burrito.length).toBeLessThanOrEqual(3);
    expect(distinct(breakfasts)).toBeGreaterThanOrEqual(4);
  });

  it("keeps lunch and dinner mains off a single protein family", () => {
    const days = week(BALANCED);
    const mains = days.flatMap((day) => [day.meals[1], day.meals[2]]);
    const families = new Set(mains.map((meal) =>
      /salmon|tuna|anchov|unagi|scallop/i.test(meal.name) ? "fish"
        : /beef|wagyu|steak|tenderloin/i.test(meal.name) ? "beef"
        : /chicken|geisha|peri|teriyaki|bali/i.test(meal.name) ? "chicken"
        : "other"));

    expect(families.size).toBeGreaterThanOrEqual(2);
  });

  it("never serves the same dish twice in one day", () => {
    for (const targets of [HIGH_PROTEIN, BALANCED]) {
      for (const day of week(targets)) {
        const names = day.meals.map((meal) => meal.name);
        expect(distinct(names), `day ${day.day} of ${targets.protein_g} g protein`)
          .toBe(names.length);
      }
    }
  });

  it("keeps every day inside tolerance while it varies", () => {
    for (const day of week(HIGH_PROTEIN)) {
      expect(day.adherence.classification, `day ${day.day}`).toBe("Within tolerance");
      expect(day.adherence.compliant).toBe(true);
    }
  });
});

/**
 * Breakfast is where repetition is most visible and where the menu offers the
 * fewest genuinely different answers — so it gets its own block. The first fix
 * for it stopped one dish taking all seven mornings and let the *next* dish
 * take them instead, because nothing in the optimizer could tell a pancake from
 * an oatmeal bowl from Before Cardio: every ready breakfast carried the same
 * archetype. These guard both levels, exact dish and style.
 */
describe("breakfast rotates by style, not just by dish", () => {
  const breakfastsOf = (days: GeneratedDay[]) => days.map((day) => day.meals[0]);

  it("rotates exact dishes and styles across the week", () => {
    const meals = breakfastsOf(week(HIGH_PROTEIN));
    const names = meals.map((meal) => meal.name);
    const styles = meals.map((meal) => meal.dishStyle);

    expect(distinct(names), "distinct exact breakfasts").toBeGreaterThanOrEqual(4);
    expect(distinct(styles), "distinct breakfast styles").toBeGreaterThanOrEqual(3);
    expect(mostRepeated(names), "most repeated exact breakfast").toBeLessThanOrEqual(3);
    expect(consecutive(names), "same breakfast on consecutive days").toEqual([]);
  });

  it("keeps the same breakfast to at most twice at this target", () => {
    // Asserted separately from the <= 3 bound above, so the weaker guarantee
    // still holds if a future menu change makes this one unreachable.
    expect(mostRepeated(breakfastsOf(week(HIGH_PROTEIN)).map((meal) => meal.name)))
      .toBeLessThanOrEqual(2);
  });

  it.each(["Before Cardio", "Breakfast Protein Burrito"])(
    "does not let %s become the default breakfast", (dish) => {
      // Both are legitimate menu breakfasts and neither is banned. The burrito
      // took all seven mornings before the repeat penalties escalated; Before
      // Cardio then took three, because it was the only ready breakfast filed
      // as an egg dish and so sat in a repeat bucket of its own.
      for (const targets of [HIGH_PROTEIN, BALANCED]) {
        const names = breakfastsOf(week(targets)).map((meal) => meal.name);
        expect(names.filter((name) => name.includes(dish)).length,
          `${dish} at ${targets.protein_g} g protein`).toBeLessThanOrEqual(2);
      }
    });

  it("does not pay for breakfast variety with adherence", () => {
    for (const targets of [HIGH_PROTEIN, BALANCED]) {
      for (const day of week(targets)) {
        expect(day.adherence.classification, `day ${day.day}`).toBe("Within tolerance");
      }
    }
  });

  it("reaches for a pancake, waffle or oatmeal breakfast where a compliant day has one", () => {
    // At HIGH_PROTEIN none of them fit: the sweet breakfasts are 1085-1175 kcal
    // with 38-54 g of fat, which leaves the other three meals 12-29 g of fat to
    // work with, and a single 150 g chicken portion is already 5 g. Rather than
    // skip the assertion, prove it — then assert the rotation does appear at a
    // target where those days genuinely exist.
    const sweet = /pancake|waffle|oatmeal/i;
    const compliantWithSweet = (targets: MacroTargets) => generatePlan({
      days: [0], slots: SLOTS, targets, savedDishes: [], includeSavedDishes: false,
      includeMenuDishes: true, includeComposed: true, dailyBudgetIdr: null,
      preferences: DEFAULT_PREFERENCES, seed: 1,
    } as Parameters<typeof generatePlan>[0])[0];

    expect(compliantWithSweet(HIGH_PROTEIN).adherence.classification).toBe("Within tolerance");
    expect(breakfastsOf(week(HIGH_PROTEIN)).some((meal) => sweet.test(meal.name)))
      .toBe(false);

    const roomForSweet: MacroTargets = {
      energy_kcal: 2600, protein_g: 130, carbs_g: 330, fat_g: 80,
    };
    const sweetWeek = week(roomForSweet);
    const names = breakfastsOf(sweetWeek).map((meal) => meal.name);
    expect(names.some((name) => sweet.test(name)),
      `expected a sweet breakfast among ${names.join(", ")}`).toBe(true);
    expect(distinct(names)).toBeGreaterThanOrEqual(3);
    expect(consecutive(names)).toEqual([]);
    for (const day of sweetWeek) {
      expect(day.adherence.classification).toBe("Within tolerance");
    }
  });

  it("gives every ready breakfast its own style", () => {
    const styles = Object.entries(NEGRITA_PLANNER_METADATA)
      .filter(([, value]) => value.mealArchetype === "breakfast");
    expect(styles.length).toBeGreaterThanOrEqual(7);
    // A pancake, a waffle, an oatmeal bowl and a fruit-and-toast plate are four
    // different breakfasts; before this they were four identical ones.
    expect(distinct(styles.map(([, value]) => value.dishStyle)))
      .toBeGreaterThanOrEqual(5);
    expect(NEGRITA_PLANNER_METADATA.before_cardio.dishStyle)
      .not.toBe(NEGRITA_PLANNER_METADATA.special_protein_pancake.dishStyle);
  });
});

describe("ready Negrita dishes stay first-class", () => {
  it("uses menu dishes, on their published macros, inside a varied week", () => {
    const days = week(HIGH_PROTEIN);
    const published = new Map(menuRecipes.map((recipe) =>
      [recipe.name, negritaMenuCandidate(recipe)?.optimizerMacros]));
    const ready = days.flatMap((day) => day.meals).filter((meal) => meal.kind === "ready");

    expect(ready.length).toBeGreaterThan(0);
    for (const meal of ready) {
      const expected = published.get(meal.name);
      if (!expected) continue;
      expect(meal.macros, meal.name).toEqual(expected);
    }
  });

  it("still offers Geisha for lunch or dinner", () => {
    const geisha = negritaMenuCandidate(menuRecipes.find((recipe) =>
      recipe.recipe_id === "geisha")!)!;
    const day = generatePlan({
      days: [0], slots: ["Lunch"], targets: {
        energy_kcal: geisha.optimizerMacros.energy_kcal,
        protein_g: geisha.optimizerMacros.protein_g,
        carbs_g: geisha.optimizerMacros.carbs_g,
        fat_g: geisha.optimizerMacros.fat_g,
      }, savedDishes: [], includeSavedDishes: false, includeMenuDishes: true,
      includeComposed: true, dailyBudgetIdr: null, preferences: DEFAULT_PREFERENCES,
      seed: 1,
    } as Parameters<typeof generatePlan>[0])[0];

    expect(day.meals[0].name).toContain("Geisha");
    expect(day.meals[0].kind).toBe("ready");
  });

  it("keeps dinner mains out of breakfast", () => {
    const breakfasts = inSlot(week(BALANCED), 0);
    const dinnerFood = /peri.?peri chicken|teriyaki chicken|mushroom sauce|steak|wagyu|kofta|kebab|unagi|thai boy|ritual burger/i;
    expect(breakfasts.filter((name) => dinnerFood.test(name))).toEqual([]);
  });
});

describe("preferences reach every candidate source", () => {
  it("tilts the week toward fish, including fish dishes from the menu", () => {
    const fish = /salmon|tuna|anchov|unagi|scallop|tobiko/i;
    const countFish = (days: GeneratedDay[]) =>
      days.flatMap((day) => day.meals).filter((meal) => fish.test(meal.name)).length;

    const neutralWeek = week(HIGH_PROTEIN);
    const leaningWeek = week(HIGH_PROTEIN, {
      preferences: { ...DEFAULT_PREFERENCES, proteinLean: ["fish"] },
    });

    // Salmon and tuna arrive both as composed plates and as published menu
    // dishes; the lean has to reach both, which it could not while ready meals
    // were hard-coded as never leaned.
    expect(countFish(leaningWeek)).toBeGreaterThan(countFish(neutralWeek));
    expect(leaningWeek.some((day) => day.meals.some((meal) =>
      meal.kind === "ready" && fish.test(meal.name)))).toBe(true);
    // A lean is a preference and ranks below adherence: it may reorder
    // compliant days, never produce a worse one.
    for (const day of leaningWeek) {
      expect(day.adherence.classification).toBe("Within tolerance");
    }
  });

  it("honours the avoid list absolutely", () => {
    const days = week(BALANCED, {
      preferences: { ...DEFAULT_PREFERENCES,
        avoidIngredientIds: ["chicken_breast_raw", "chicken_teriyaki_negrita"] },
    });
    const used = days.flatMap((day) => day.meals).flatMap((meal) =>
      meal.items.map((item) => item.ingredientId));

    expect(used).not.toContain("chicken_breast_raw");
    expect(used).not.toContain("chicken_teriyaki_negrita");
  });
});

describe("seed behaviour", () => {
  it("is identical for the same seed and varies only equivalent weeks", () => {
    const first = week(HIGH_PROTEIN, { seed: 5 });
    expect(week(HIGH_PROTEIN, { seed: 5 })).toEqual(first);

    const other = week(HIGH_PROTEIN, { seed: 6 });
    const classes = [...first, ...other].map((day) => day.adherence.classification);
    expect(new Set(classes).size, "a shuffle may not change adherence").toBe(1);

    const signature = (days: GeneratedDay[]) =>
      days.map((day) => day.meals.map((meal) => meal.name).join("|"));
    expect(signature(other)).not.toEqual(signature(first));
  });
});

describe("derived targets", () => {
  it("scales a coherent 4000 kcal week and retains substantial breakfasts", () => {
    const days = week(BALANCED_4000);
    const average = days.reduce((sum, day) => sum + day.macros.energy_kcal, 0) / days.length;
    const breakfasts = inSlot(days, 0);
    expect(average).toBeGreaterThan(3400);
    expect(distinct(breakfasts), breakfasts.join(", ")).toBeGreaterThanOrEqual(2);
    expect(breakfasts.some((name) => /pancake|waffle|oatmeal|banana bread/i.test(name)),
      breakfasts.join(", ")).toBe(true);
    for (const day of days) {
      expect(day.adherence.macros.energy_kcal.target).toBe(4000);
      expect(day.macros.energy_kcal).toBeGreaterThan(3000);
    }
  });

  it("resolves Auto to the documented default and reports what it used", () => {
    const generated = generatePlanWithTargets({
      days: [0], slots: SLOTS, targets: null, savedDishes: [],
      includeSavedDishes: false, includeMenuDishes: true, includeComposed: true,
      dailyBudgetIdr: null, seed: 1,
    } as Parameters<typeof generatePlanWithTargets>[0]);

    expect(generated.targetSource).toBe("derived");
    expect(generated.targetStyle).toBe("Balanced");
    expect(generated.resolvedTarget.energy_kcal).toBe(2000);
    expect(generated.resolvedTarget.protein_g).toBeCloseTo(125, 6);
    // The days must be measured against the very target that was generated
    // against, not against nothing and not against a different default.
    expect(generated.days[0].adherence.macros.energy_kcal.target).toBe(2000);
    expect(generated.days[0].adherence.macros.protein_g.target)
      .toBe(generated.resolvedTarget.protein_g);
  });
});
