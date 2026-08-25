import { describe, expect, it } from "vitest";
import { generatePlan, generatePlanWithTargets, type GeneratedDay } from "@/lib/mealPlanner";
import { menuRecipes } from "@/lib/database";
import { negritaMenuCandidate } from "@/lib/plannerCandidates";
import { NEGRITA_PLANNER_METADATA } from "@/lib/negritaPlannerMetadata";
import { DEFAULT_PREFERENCES, type MacroTargets } from "@/lib/storage/types";
import { plannerFixture } from "@/lib/mealPlanner.fixtures";
import type { PlannerCandidate } from "@/types/nutrition";

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

/**
 * What each day put in one slot, by name — empty for a day that deliberately
 * went without an optional slot, so the seven entries stay aligned to the seven
 * days and "the same dish two days running" still means what it says.
 */
const inSlot = (days: GeneratedDay[], slot: string) =>
  days.map((day) => day.meals.find((meal) => meal.slot === slot)?.name ?? "");
const filled = (values: string[]) => values.filter(Boolean);
const distinct = (values: string[]) => new Set(values).size;
const mostRepeated = (values: string[]) =>
  Math.max(...[...new Set(values)].map((value) =>
    values.filter((other) => other === value).length));
const consecutive = (values: string[]) =>
  values.filter((value, index) => Boolean(value) && index > 0 && values[index - 1] === value);
const hasThreeConsecutive = (values: string[]) => values.some((value, index) =>
  index >= 2 && values[index - 1] === value && values[index - 2] === value);

const ADHERENCE_ORDER = ["Exact", "Within tolerance", "Best effort", "Impossible"] as const;
type AdherenceClass = typeof ADHERENCE_ORDER[number];
const bestClass = (days: GeneratedDay[]): AdherenceClass => ADHERENCE_ORDER.find((value) =>
  days.some((day) => day.adherence.classification === value))!;

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
  it("preserves hard constraints and adherence across many shuffle seeds", () => {
    const avoidIngredientIds = ["chicken_breast_raw"];
    const preferences = { ...DEFAULT_PREFERENCES, avoidIngredientIds };
    const baseline = week(BALANCED, { seed: 20, preferences, dailyBudgetIdr: 400_000 });
    const classifications = baseline.map((day) => day.adherence.classification);

    for (let seed = 21; seed <= 28; seed += 1) {
      const shuffled = week(BALANCED, { seed, preferences, dailyBudgetIdr: 400_000 });
      expect(shuffled.map((day) => day.adherence.classification), `seed ${seed} adherence`)
        .toEqual(classifications);
      for (const day of shuffled) {
        expect(day.price.totalIdr, `seed ${seed}, day ${day.day} budget`).toBeLessThanOrEqual(400_000);
        expect(day.meals.flatMap((meal) => meal.items).some((item) =>
          avoidIngredientIds.includes(item.ingredientId)), `seed ${seed} exclusion`).toBe(false);
        expect(new Set(day.meals.map((meal) => meal.slot)).size, `seed ${seed} slot suitability`)
          .toBe(day.meals.length);
      }
    }
    // Nine whole weeks against the real catalog, each a full search. The
    // project's 20 s default is sized for a single generation; here it would be
    // measuring how busy the machine is rather than whether shuffling holds its
    // constraints.
  }, 120_000);

  it("produces seven visibly different days", () => {
    const days = week(HIGH_PROTEIN);
    const signatures = days.map((day) => day.meals.map((meal) => meal.name).join(" | "));
    const everything = days.flatMap((day) => day.meals.map((meal) => meal.name));

    expect(days).toHaveLength(7);
    expect(distinct(signatures), "no two identical days").toBe(7);
    expect(distinct(everything)).toBeGreaterThanOrEqual(12);
    for (const day of days) {
      // Every slot the day needs is filled; a snack it chose to go without is
      // reported as skipped rather than missing, and leaves the day complete.
      expect(day.meals.map((meal) => meal.slot))
        .toEqual(SLOTS.filter((slot) => !day.skippedSlots.includes(slot)));
      expect(day.skippedSlots.filter((slot) => slot !== "Snack")).toEqual([]);
      expect(day.unfilledSlots).toEqual([]);
      expect(day.adherence.classification).not.toBe("Impossible");
    }
  });

  it.each(SLOTS)("varies %s across the week and never repeats it on adjacent days", (slot) => {
    const names = inSlot(week(HIGH_PROTEIN), slot);
    expect(distinct(filled(names)), `distinct choices for ${slot}`).toBeGreaterThanOrEqual(4);
    expect(mostRepeated(filled(names)), `most repeated ${slot}`).toBeLessThanOrEqual(3);
    expect(consecutive(names), `${slot} repeated on consecutive days`).toEqual([]);
  });

  it("keeps a snack on most days, and leaves one out without leaving the day short", () => {
    const days = week(HIGH_PROTEIN);
    const withSnack = days.filter((day) => day.meals.some((meal) => meal.slot === "Snack"));

    // Skipping is variety, not the new default: the repeat machinery charges
    // "no snack" like any other repeated choice, so it stays occasional.
    expect(withSnack.length, "days carrying a snack").toBeGreaterThanOrEqual(5);
    for (const day of days) {
      if (withSnack.includes(day)) continue;
      expect(day.skippedSlots).toEqual(["Snack"]);
      expect(day.adherence.compliant, "a skipped snack still leaves a complete day").toBe(true);
    }
  });

  it("does not let the Breakfast Protein Burrito become the default breakfast", () => {
    const breakfasts = inSlot(week(HIGH_PROTEIN), "Breakfast");
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

  // Whether a 1,085-1,175 kcal pancake, waffle or oatmeal bowl can be part of a
  // day that adheres is a question about the whole day, not about this week, and
  // it is asked directly in mealPlannerBreakfast.test.ts: the dish is locked into
  // the slot and the rest of the day solved around it. Inferring the answer from
  // whether a week happened to contain one — which is what used to be asserted
  // here — is how they came to be written off as impossible.

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
    const breakfasts = inSlot(week(BALANCED), "Breakfast");
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
  it("scales a coherent 4000 kcal target without trading adherence for repetition", () => {
    const days = week(BALANCED_4000, { seed: 2 });
    // A one-day request establishes the strongest class the catalog can reach
    // without weekly variety influencing the selection.
    const achievable = bestClass(week(BALANCED_4000, { days: [0] }));
    const namesBySlot = SLOTS.map((slot) => inSlot(days, slot));
    const breakfastStyles = days.map((day) => day.meals[0].dishStyle);
    const signatures = days.map((day) => day.meals.map((meal) => meal.name).join(" | "));

    for (const day of days) {
      expect(day.adherence.macros.energy_kcal.target).toBe(4000);
      expect(day.adherence.classification).toBe(achievable);
      if (achievable === "Exact" || achievable === "Within tolerance") {
        expect(day.adherence.compliant).toBe(true);
      }
    }
    // The real-catalog probe currently establishes two Breakfast variants in
    // this best class; the focused locked fixture below is the regression that
    // prevents the week from collapsing below the proven feasible minimum.
    expect(distinct(namesBySlot[0]), namesBySlot[0].join(", ")).toBeGreaterThanOrEqual(2);
    expect(distinct(breakfastStyles), breakfastStyles.join(", ")).toBeGreaterThanOrEqual(2);
    expect(distinct(namesBySlot[1]), namesBySlot[1].join(", ")).toBeGreaterThanOrEqual(2);
    expect(distinct(namesBySlot[2]), namesBySlot[2].join(", ")).toBeGreaterThanOrEqual(2);
    expect(distinct(namesBySlot[3]), namesBySlot[3].join(", ")).toBeGreaterThanOrEqual(2);
    for (const index of [1, 2, 3]) {
      expect(mostRepeated(namesBySlot[index]), `${SLOTS[index]} occupied the whole week`)
        .toBeLessThan(7);
    }
    expect(distinct(signatures), "the real catalog still varies full days").toBeGreaterThan(1);
    expect(days.some((day) => day.meals.some((meal) => meal.kind === "ready")))
      .toBe(true);
    expect(days.some((day) => day.meals.some((meal) => meal.kind === "composed")))
      .toBe(true);
  });

  it("does not collapse four-slot fixture weeks when equivalent choices are proven", () => {
    const quarter = { energy_kcal: 1000, protein_g: 62.5, carbs_g: 112.5,
      fat_g: BALANCED_4000.fat_g / 4 };
    const fixtures: PlannerCandidate[] = [
      plannerFixture("Breakfast oats", "Breakfast", quarter),
      plannerFixture("Breakfast eggs", "Breakfast", quarter),
      ...["Lunch chicken", "Lunch fish", "Lunch beef"].map((name) =>
        plannerFixture(name, "Lunch", quarter)),
      ...["Dinner chicken", "Dinner fish", "Dinner beef"].map((name) =>
        plannerFixture(name, "Dinner", quarter)),
      ...["Snack yoghurt", "Snack fruit", "Snack toast"].map((name) =>
        plannerFixture(name, "Snack", quarter)),
    ];
    const options = {
      days: WEEK, slots: SLOTS, targets: BALANCED_4000, savedDishes: [],
      includeSavedDishes: false, includeMenuDishes: false, includeComposed: false,
      candidateFixtures: fixtures, dailyBudgetIdr: null,
      preferences: DEFAULT_PREFERENCES, seed: 1,
    } as Parameters<typeof generatePlan>[0];
    const days = generatePlan(options);
    const achievable = bestClass(generatePlan({ ...options, days: [0] }));

    // Lock each candidate in turn by making it the only fixture for its slot.
    // Other slots retain their complete fixture catalogs. Diversity is required
    // only where two different locks independently preserve the best class.
    const feasibleBySlot = SLOTS.map((slot) => fixtures.filter((candidate) =>
      candidate.eligibleMealTypes.includes(slot.toLowerCase())).filter((locked) => {
      const candidateFixtures = fixtures.filter((candidate) =>
        !candidate.eligibleMealTypes.includes(slot.toLowerCase()) || candidate === locked);
      const probe = generatePlan({ ...options, days: [0], candidateFixtures })[0];
      return probe.adherence.classification === achievable &&
        probe.meals.some((meal) => meal.name === locked.displayName);
    }));

    expect(achievable).toBe("Exact");
    expect(days).toHaveLength(7);
    for (const day of days) {
      expect(day.meals).toHaveLength(4);
      expect(day.adherence.classification).toBe(achievable);
      expect(day.adherence.compliant).toBe(true);
    }
    for (const [index, feasible] of feasibleBySlot.entries()) {
      if (feasible.length < 2) continue;
      const names = inSlot(days, SLOTS[index]);
      const requestedMinimum = [2, 3, 3, 2][index];
      expect(distinct(names),
        `${SLOTS[index]} collapsed despite feasible locks: ${feasible.map((c) => c.displayName)}`)
        .toBeGreaterThanOrEqual(Math.min(requestedMinimum, feasible.length));
      expect(hasThreeConsecutive(names),
        `${SLOTS[index]} repeated three times despite an equally compliant lock`).toBe(false);
    }
    expect(distinct(inSlot(days, "Breakfast"))).toBe(2);
    expect(distinct(inSlot(days, "Lunch"))).toBeGreaterThanOrEqual(3);
    expect(distinct(inSlot(days, "Dinner"))).toBeGreaterThanOrEqual(3);
    expect(distinct(inSlot(days, "Snack"))).toBeGreaterThanOrEqual(2);
    expect(new Set(days.flatMap((day) => [day.meals[1], day.meals[2]]).map((meal) =>
      meal.name.split(" ").at(-1))).size, "lunch and dinner rotate protein families")
      .toBeGreaterThanOrEqual(2);
    expect(distinct(days.map((day) => day.meals.map((meal) => meal.name).join(" | "))))
      .toBe(7);
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
