import type { Ingredient } from "@/types/nutrition";
import type { MacroStyle, MacroTargets, ProteinSource } from "@/lib/storage/types";

/**
 * Client tastes, expressed the way a coach thinks about them.
 *
 * Two very different kinds of preference live here, and the difference matters:
 * a **macro style** and a **protein lean** shape what tends to get chosen, while
 * the **avoid list** is an absolute rule. A lean never blocks a meal — "more
 * fish" should give a fish-leaning week, not a week the planner cannot fill.
 */

export interface MacroStyleSpec {
  id: MacroStyle;
  label: string;
  description: string;
  /** Share of energy from protein / carbs / fat. Sums to 1. */
  split: { protein: number; carbs: number; fat: number };
}

export const MACRO_STYLES: MacroStyleSpec[] = [
  {
    id: "high_protein",
    label: "High protein",
    description: "Protein-led, moderate carbs",
    split: { protein: 0.35, carbs: 0.35, fat: 0.3 },
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "An even spread",
    split: { protein: 0.25, carbs: 0.45, fat: 0.3 },
  },
  {
    id: "low_carb",
    label: "Low carb",
    description: "Fat-led, carbs kept down",
    split: { protein: 0.3, carbs: 0.15, fat: 0.55 },
  },
  {
    id: "high_carb",
    label: "High carb",
    description: "Carb-led, for heavy training",
    split: { protein: 0.2, carbs: 0.55, fat: 0.25 },
  },
];

export function macroStyleSpec(style: MacroStyle): MacroStyleSpec {
  return MACRO_STYLES.find((s) => s.id === style) ?? MACRO_STYLES[1];
}

/**
 * Turn a calorie figure plus a style into gram targets, so a coach can choose
 * "low carb" instead of typing four numbers. The numbers stay editable after.
 */
export function targetsFromStyle(
  energyKcal: number,
  style: MacroStyle
): MacroTargets {
  const { split } = macroStyleSpec(style);
  return {
    energy_kcal: Math.round(energyKcal),
    protein_g: Math.round((energyKcal * split.protein) / 4),
    carbs_g: Math.round((energyKcal * split.carbs) / 4),
    fat_g: Math.round((energyKcal * split.fat) / 9),
  };
}

export interface ProteinSourceSpec {
  id: ProteinSource;
  label: string;
}

export const PROTEIN_SOURCES: ProteinSourceSpec[] = [
  { id: "chicken", label: "Chicken" },
  { id: "beef", label: "Beef" },
  { id: "fish", label: "Fish & seafood" },
  { id: "eggs", label: "Eggs" },
  { id: "pork", label: "Pork" },
  { id: "veg", label: "Vegetarian" },
];

/**
 * Which family a protein belongs to. Matched on the ingredient id first because
 * it is stable, falling back to the food category.
 */
export function proteinSourceOf(ingredient: Ingredient): ProteinSource | null {
  const id = ingredient.ingredient_id;

  if (/chicken/.test(id)) return "chicken";
  if (/beef|wagyu|steak|tenderloin/.test(id)) return "beef";
  if (/bacon|ham_/.test(id)) return "pork";
  if (/egg_/.test(id)) return "eggs";
  if (/salmon|tuna|anchovy|tobiko|scallop|eel|fish/.test(id)) return "fish";

  switch (ingredient.category) {
    case "fish":
    case "seafood":
      return "fish";
    case "egg":
      return "eggs";
    case "meat":
      return "beef";
    case "legume":
    case "dairy":
    case "vegetable":
    case "grain":
      return "veg";
    default:
      return null;
  }
}

/** True when this ingredient (or anything in a dish) is on the avoid list. */
export function isAvoided(
  ingredientId: string,
  avoidIngredientIds: string[]
): boolean {
  return avoidIngredientIds.includes(ingredientId);
}
