import { generatedDiyCandidate } from "@/lib/plannerCandidates";
import type { Macros, PlannerCandidate } from "@/types/nutrition";
import type { DishItem, MacroTargets } from "@/lib/storage/types";

export const COMPLETE_DAY_TARGET: MacroTargets = {
  energy_kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 70,
};

let fixtureIndex = 0;

/** A bounded planner candidate with explicit culinary slot metadata. */
export function plannerFixture(
  name: string,
  slot: "Breakfast" | "Lunch" | "Dinner",
  macros: Omit<Macros, "fiber_g"> & { fiber_g?: number },
  ingredientId = `fixture_${fixtureIndex}`
): PlannerCandidate {
  fixtureIndex += 1;
  const items: DishItem[] = [{ ingredientId, name: ingredientId, grams: 100,
    unitId: "g", quantity: 100 }];
  const candidate = generatedDiyCandidate({ id: `${name}_${fixtureIndex}`, name, items,
    macros: { ...macros, fiber_g: macros.fiber_g ?? 0 }, priceIdr: 25_000 });
  candidate.mealArchetype = slot.toLowerCase();
  candidate.eligibleMealTypes = [slot.toLowerCase()];
  return candidate;
}

export const compensatingDayFixtures = () => [
  plannerFixture("Light protein breakfast", "Breakfast",
    { energy_kcal: 600, protein_g: 30, carbs_g: 60, fat_g: 20 }),
  plannerFixture("Geisha-style high protein lunch", "Lunch",
    { energy_kcal: 750, protein_g: 70, carbs_g: 75, fat_g: 25 }),
  plannerFixture("Lower protein dinner", "Dinner",
    { energy_kcal: 650, protein_g: 50, carbs_g: 65, fat_g: 25 }),
];

export const extremeCalorieDayFixtures = () => [
  plannerFixture("Small but necessary breakfast", "Breakfast",
    { energy_kcal: 200, protein_g: 30, carbs_g: 20, fat_g: 0 }),
  plannerFixture("Compensating lunch", "Lunch",
    { energy_kcal: 900, protein_g: 60, carbs_g: 90, fat_g: 30 }),
  plannerFixture("Compensating dinner", "Dinner",
    { energy_kcal: 900, protein_g: 60, carbs_g: 90, fat_g: 40 }),
];
