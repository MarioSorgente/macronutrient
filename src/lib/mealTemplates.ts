import type { DiySection, Ingredient } from "@/types/nutrition";

export type MealComponentRole = "protein" | "carb" | "vegetable" | "sauce" | "fat";
export type MealFamily = string;

export interface QuantityRange { minG: number; maxG: number }

export interface MealTemplate {
  id: string;
  name: string;
  allowedSlots: string[];
  requiredRoles: MealComponentRole[];
  optionalRoles: MealComponentRole[];
  compatibleFamilies: Record<MealComponentRole, MealFamily[]>;
  /** A culinary serving envelope, not a slot macro target. */
  mealSize: { minKcal: number; maxKcal: number };
  quantities: Record<MealComponentRole, QuantityRange>;
}

const ANY_PROTEIN = ["chicken", "beef", "fish", "eggs", "vegetarian"];
const MAIN_CARBS = ["rice", "buckwheat", "potato", "bread", "wrap", "legume", "quinoa"];
const VEGETABLES = ["greens", "roasted", "cruciferous", "tomato", "mushroom", "beet", "corn"];
const SAUCES = ["neutral", "yogurt", "hummus", "tzatziki", "cheese", "butter"];
const FATS = ["avocado", "cheese", "yogurt", "hummus", "butter"];

type MealTemplateDeclaration = Omit<MealTemplate, "quantities"> & {
  quantities: Partial<Record<MealComponentRole, QuantityRange>>;
};

function template(value: MealTemplateDeclaration): MealTemplate {
  return { ...value, quantities: {
    protein: { minG: 50, maxG: 250 }, carb: { minG: 35, maxG: 300 },
    vegetable: { minG: 40, maxG: 300 }, sauce: { minG: 10, maxG: 80 },
    fat: { minG: 10, maxG: 120 }, ...value.quantities,
  } };
}

/**
 * Culinary rules are deliberately data rather than optimizer heuristics. This
 * keeps adding an archetype auditable and stops a good macro score from
 * silently redefining what (for example) a salad or breakfast is.
 */
export const MEAL_TEMPLATES: readonly MealTemplate[] = [
  template({ id: "breakfast-bowl", name: "Breakfast bowl", allowedSlots: ["breakfast"],
    requiredRoles: ["carb", "protein"], optionalRoles: ["vegetable", "fat"],
    compatibleFamilies: { protein: ["eggs", "vegetarian"], carb: ["oats", "potato", "legume"],
      vegetable: ["mushroom", "tomato"], sauce: ["yogurt"], fat: ["yogurt", "cheese", "avocado"] },
    mealSize: { minKcal: 280, maxKcal: 850 }, quantities: { protein: { minG: 60, maxG: 200 },
      carb: { minG: 50, maxG: 250 }, vegetable: { minG: 50, maxG: 180 }, fat: { minG: 20, maxG: 120 } } }),
  template({ id: "eggs-and-toast", name: "Eggs and toast", allowedSlots: ["breakfast"],
    requiredRoles: ["protein", "carb"], optionalRoles: ["vegetable", "fat"],
    compatibleFamilies: { protein: ["eggs"], carb: ["bread"], vegetable: ["mushroom", "tomato"],
      sauce: ["neutral"], fat: ["avocado", "cheese", "butter"] }, mealSize: { minKcal: 250, maxKcal: 750 },
    quantities: { protein: { minG: 80, maxG: 200 }, carb: { minG: 35, maxG: 140 },
      vegetable: { minG: 40, maxG: 150 }, fat: { minG: 15, maxG: 100 } } }),
  template({ id: "protein-breakfast", name: "Protein breakfast", allowedSlots: ["breakfast"],
    requiredRoles: ["protein"], optionalRoles: ["carb", "vegetable", "fat"],
    compatibleFamilies: { protein: ["eggs", "breakfast-meat", "fish"], carb: ["bread", "potato", "legume"],
      vegetable: ["mushroom", "tomato"], sauce: ["yogurt"], fat: ["avocado", "cheese", "yogurt"] },
    mealSize: { minKcal: 220, maxKcal: 800 }, quantities: { protein: { minG: 60, maxG: 220 },
      carb: { minG: 35, maxG: 180 }, vegetable: { minG: 40, maxG: 150 }, fat: { minG: 15, maxG: 100 } } }),
  template({ id: "rice-bowl", name: "Rice bowl", allowedSlots: ["lunch", "dinner"],
    requiredRoles: ["protein", "carb", "vegetable"], optionalRoles: ["sauce", "fat"],
    compatibleFamilies: { protein: ANY_PROTEIN, carb: ["rice"], vegetable: VEGETABLES,
      sauce: ["neutral", "yogurt"], fat: ["avocado", "yogurt"] }, mealSize: { minKcal: 380, maxKcal: 1050 },
    quantities: { protein: { minG: 90, maxG: 300 }, carb: { minG: 100, maxG: 400 },
      vegetable: { minG: 60, maxG: 250 }, fat: { minG: 20, maxG: 100 } } }),
  template({ id: "mediterranean-plate", name: "Mediterranean plate", allowedSlots: ["lunch", "dinner"],
    requiredRoles: ["protein", "vegetable"], optionalRoles: ["carb", "sauce", "fat"],
    compatibleFamilies: { protein: ["chicken", "fish", "eggs", "vegetarian"],
      carb: ["bread", "legume", "quinoa", "potato"], vegetable: VEGETABLES,
      sauce: ["hummus", "tzatziki", "yogurt"], fat: ["hummus", "cheese", "yogurt"] },
    mealSize: { minKcal: 320, maxKcal: 950 }, quantities: { protein: { minG: 80, maxG: 250 },
      carb: { minG: 40, maxG: 220 }, vegetable: { minG: 80, maxG: 300 }, fat: { minG: 20, maxG: 100 } } }),
  template({ id: "salad", name: "Salad", allowedSlots: ["lunch", "dinner"],
    requiredRoles: ["protein", "vegetable"], optionalRoles: ["carb", "sauce", "fat"],
    compatibleFamilies: { protein: ANY_PROTEIN, carb: ["legume", "quinoa", "bread", "potato"],
      vegetable: VEGETABLES, sauce: ["yogurt", "tzatziki", "hummus"], fat: FATS },
    mealSize: { minKcal: 250, maxKcal: 850 }, quantities: { protein: { minG: 70, maxG: 250 },
      carb: { minG: 30, maxG: 160 }, vegetable: { minG: 120, maxG: 350 }, fat: { minG: 15, maxG: 100 } } }),
  template({ id: "wrap", name: "Wrap", allowedSlots: ["lunch", "dinner", "pre-workout"],
    requiredRoles: ["protein", "carb", "vegetable"], optionalRoles: ["sauce", "fat"],
    compatibleFamilies: { protein: ANY_PROTEIN, carb: ["wrap"], vegetable: ["greens", "tomato", "corn"],
      sauce: ["yogurt", "tzatziki", "hummus"], fat: ["avocado", "cheese", "yogurt", "hummus"] },
    mealSize: { minKcal: 300, maxKcal: 850 }, quantities: { protein: { minG: 70, maxG: 220 },
      carb: { minG: 55, maxG: 140 }, vegetable: { minG: 40, maxG: 160 }, fat: { minG: 15, maxG: 80 } } }),
  template({ id: "main-plus-side", name: "Main plus side", allowedSlots: ["lunch", "dinner"],
    requiredRoles: ["protein", "carb"], optionalRoles: ["vegetable", "sauce", "fat"],
    compatibleFamilies: { protein: ANY_PROTEIN, carb: MAIN_CARBS, vegetable: VEGETABLES,
      sauce: SAUCES, fat: FATS }, mealSize: { minKcal: 350, maxKcal: 1100 },
    quantities: { protein: { minG: 80, maxG: 300 }, carb: { minG: 60, maxG: 400 },
      vegetable: { minG: 60, maxG: 250 }, fat: { minG: 15, maxG: 100 } } }),
  template({ id: "snack", name: "Snack", allowedSlots: ["snack", "post-workout"],
    requiredRoles: ["protein"], optionalRoles: ["carb", "fat"],
    compatibleFamilies: { protein: ["eggs", "vegetarian", "breakfast-meat"],
      carb: ["bread", "fruit", "legume"], vegetable: ["tomato"], sauce: ["yogurt"],
      fat: ["yogurt", "cheese", "hummus"] }, mealSize: { minKcal: 120, maxKcal: 450 },
    quantities: { protein: { minG: 30, maxG: 150 }, carb: { minG: 30, maxG: 130 }, fat: { minG: 15, maxG: 70 } } }),
  template({ id: "pre-workout-meal", name: "Pre-workout meal", allowedSlots: ["pre-workout"],
    requiredRoles: ["carb"], optionalRoles: ["protein"], compatibleFamilies: {
      protein: ["chicken", "eggs", "vegetarian"], carb: ["rice", "bread", "potato", "fruit", "oats"],
      vegetable: ["tomato"], sauce: ["yogurt"], fat: ["yogurt"] },
    mealSize: { minKcal: 180, maxKcal: 600 }, quantities: { protein: { minG: 40, maxG: 150 },
      carb: { minG: 40, maxG: 250 } } }),
] as const;

const EXPLICIT_FAMILIES: Record<string, Partial<Record<MealComponentRole, string>>> = {
  bacon_streaky: { protein: "breakfast-meat" }, ham_sliced: { protein: "breakfast-meat" },
  sausage_chicken: { protein: "breakfast-meat" }, sausage_beef: { protein: "breakfast-meat" },
  chickpeas_cooked: { carb: "legume" }, baked_beans: { carb: "legume" }, quinoa_cooked: { carb: "quinoa" },
  banana_raw: { vegetable: "fruit", carb: "fruit" }, watermelon_raw: { vegetable: "fruit", carb: "fruit" },
  iceberg_or_mixed_lettuce: { vegetable: "greens" }, grilled_mixed_vegetables_proxy: { vegetable: "roasted" },
  broccoli_boiled: { vegetable: "cruciferous" }, beetroot_cooked: { vegetable: "beet" },
  mushrooms_white_proxy: { vegetable: "mushroom" }, tomato_cherry_raw: { vegetable: "tomato" },
  corn_sweet_cooked: { vegetable: "corn" }, hummus: { fat: "hummus", sauce: "hummus" },
  tzatziki_proxy: { fat: "yogurt", sauce: "tzatziki" }, greek_yogurt_nonfat: { fat: "yogurt", sauce: "yogurt" },
  anchovy_garlic_butter: { fat: "butter", sauce: "butter" }, avocado_raw: { fat: "avocado" },
};

/** Family inference plus explicit metadata for ambiguous restaurant ingredients. */
export function ingredientFamily(ingredient: Ingredient, role: MealComponentRole): string {
  const explicit = EXPLICIT_FAMILIES[ingredient.ingredient_id]?.[role];
  if (explicit) return explicit;
  const text = `${ingredient.ingredient_id} ${ingredient.name}`.toLowerCase();
  if (role === "protein") {
    if (/egg/.test(text)) return "eggs"; if (/chicken/.test(text)) return "chicken";
    if (/beef|wagyu|steak/.test(text)) return "beef"; if (/salmon|fish|anchovy|tobiko/.test(text)) return "fish";
    return "vegetarian";
  }
  if (role === "carb") {
    if (/rice/.test(text)) return "rice"; if (/buckwheat/.test(text)) return "buckwheat";
    if (/potato|hash/.test(text)) return "potato"; if (/tortilla|wrap/.test(text)) return "wrap";
    if (/bread|brioche|paratha/.test(text)) return "bread"; if (/oat/.test(text)) return "oats";
  }
  if (role === "fat") return /cheese/.test(text) ? "cheese" : "other";
  return "other";
}

export function templatesForSlot(slot: string): readonly MealTemplate[] {
  const normalized = slot.toLowerCase().replace(/\s+/g, "-");
  const matching = MEAL_TEMPLATES.filter((item) =>
    item.allowedSlots.some((allowed) => normalized.includes(allowed)));
  return matching.length ? matching : MEAL_TEMPLATES.filter((item) => item.id === "main-plus-side");
}

export function roleForSection(section: DiySection): MealComponentRole {
  return section === "protein" ? "protein" : section === "carbs" ? "carb" :
    section === "veg" ? "vegetable" : "fat";
}

export function componentFitsTemplate(template: MealTemplate, ingredient: Ingredient,
  section: DiySection, grams: number): boolean {
  const role = roleForSection(section);
  const range = template.quantities[role];
  return (!range || (grams >= range.minG && grams <= range.maxG)) &&
    template.compatibleFamilies[role].includes(ingredientFamily(ingredient, role));
}
