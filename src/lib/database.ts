import rawDatabase from "@data/negrita-database.json";
import portionData from "@data/enrichment/portions.json";
import addedData from "@data/enrichment/added-ingredients.json";
import diyData from "@data/enrichment/diy-menu.json";
import menuDescriptionData from "@data/enrichment/menu-descriptions.json";
import menuQuantityData from "@data/enrichment/menu-quantities.json";
import { diyQuantityMetadata } from "@/lib/diyQuantities";
import {
  GRAM_UNIT,
  GRAM_UNIT_ID,
  type DiyMenuItem,
  type Ingredient,
  type Macros,
  type MenuRecipe,
  type NutritionDatabase,
  type PortionUnit,
} from "@/types/nutrition";

/**
 * The bundled Negrita database. Static reference data (91 ingredients + 25 menu
 * recipes) shipped inside the app — no network call is needed to browse
 * ingredients or calculate macros.
 *
 * The source JSON is never mutated. Portion units are merged in from the
 * curated enrichment overlay (data/enrichment/portions.json) so Negrita's
 * provenance record stays intact and every addition is auditable.
 */
const database = rawDatabase as unknown as NutritionDatabase;

const portions = (
  portionData as {
    ingredients: Record<
      string,
      { units: PortionUnit[]; defaultUnitId?: string }
    >;
  }
).ingredients;

/** Items on Negrita's DIY menu, keyed by the ingredient they are sold as. */
export const diyMenu: DiyMenuItem[] = (diyData as { items: DiyMenuItem[] }).items;

const diyByIngredient = new Map<string, DiyMenuItem>();
for (const item of diyMenu) {
  // A few ingredients back two DIY lines (ground beef / patty). Keep the first;
  // they share the same portion and price.
  if (!diyByIngredient.has(item.ingredient_id)) {
    diyByIngredient.set(item.ingredient_id, item);
  }
}

type BaseIngredient = NutritionDatabase["ingredients"][number];

/**
 * Ingredients present on the DIY menu but absent from the source database.
 * Provenance is preserved per record (verified_usda vs menu_stated).
 */
const addedIngredients = (addedData as { ingredients: BaseIngredient[] })
  .ingredients;

function decorate(base: BaseIngredient): Ingredient {
  const overlay = portions[base.ingredient_id];
  const diy = diyByIngredient.get(base.ingredient_id);
  return {
    ...base,
    // Grams first: always available, always the fallback.
    units: [GRAM_UNIT, ...(overlay?.units ?? [])],
    defaultUnitId: overlay?.defaultUnitId ?? GRAM_UNIT_ID,
    ...(diy
      ? {
          price_idr: diy.price_idr,
          diy_portion_g: diy.portion_g,
          diy_name: diy.name,
          diy_section: diy.section,
          diy_quantity: diyQuantityMetadata(diy),
        }
      : {}),
  };
}

export const ingredients: Ingredient[] = [
  ...database.ingredients,
  ...addedIngredients,
].map(decorate);

const menuText = menuDescriptionData as {
  menu_note: string;
  brand_note: string;
  section_notes: Record<string, string>;
  descriptions: Record<string, string>;
};

/** What the printed menu says about each dish, and about the menu as a whole. */
export const menuNotes = {
  /** "Weights and macros are estimated from raw ingredients before cooking." */
  measurement: menuText.menu_note,
  brand: menuText.brand_note,
  forSection: (section: string): string | undefined =>
    menuText.section_notes[section],
};

/**
 * Gram quantities the printed menu leaves out, derived by fitting each recipe
 * to the macros the menu itself publishes (scripts/fit-menu-quantities.mjs).
 *
 * Without these, 24 of the 25 menu dishes compute from only their stated
 * components — understating their macros by 30-90%, and leaving five so far
 * below any plausible target that the planner discarded them outright. An
 * Oatmeal Bowl came to 108 kcal, which is why oats, pancakes and waffles never
 * appeared in a generated week.
 */
const fittedQuantities = (
  menuQuantityData as {
    recipes: Record<
      string,
      {
        quantities: Record<string, number>;
        fit: { worst_macro: string; worst_pct: number };
      }
    >;
  }
).recipes;

export const menuRecipes: MenuRecipe[] = database.menu_recipes.map((recipe) => {
  const fitted = fittedQuantities[recipe.recipe_id];
  if (!fitted) {
    return { ...recipe, description: menuText.descriptions[recipe.recipe_id] };
  }

  const components = recipe.components.map((component) =>
    component.quantity_g == null &&
    typeof fitted.quantities[component.ingredient_id] === "number"
      ? { ...component, quantity_g: fitted.quantities[component.ingredient_id] }
      : component
  );

  return {
    ...recipe,
    components,
    description: menuText.descriptions[recipe.recipe_id],
    quantity_complete: components.every((c) => c.quantity_g != null),
    derived_quantities: {
      worstPct: fitted.fit.worst_pct,
      worstMacro: fitted.fit.worst_macro,
    },
  };
});

const MENU_MACRO_KEYS: (keyof Macros)[] = [
  "energy_kcal", "protein_g", "carbs_g", "fat_g", "fiber_g",
];

/**
 * What the printed menu publishes for one serving, when it publishes all of it.
 *
 * This is what a menu dish *is* nutritionally, and it is not the same number as
 * adding its components up: the gram quantities above are a best fit to these
 * macros, not the recipe the kitchen works from, and they land 3-11% out on
 * calories and up to 11% out on protein. The diner is sold the menu's figure,
 * so the menu's figure is the one a plan has to count.
 */
export function publishedMenuMacros(recipe: MenuRecipe): Macros | null {
  const macros = recipe.menu_macros_per_serving;
  return MENU_MACRO_KEYS.every((key) => Number.isFinite(macros[key]))
    ? Object.fromEntries(MENU_MACRO_KEYS.map((key) => [key, macros[key]])) as unknown as Macros
    : null;
}

export const databaseMeta = {
  name: database.database_name,
  version: database.schema_version,
  generatedOn: database.generated_on,
};

const ingredientById = new Map<string, Ingredient>(
  ingredients.map((ing) => [ing.ingredient_id, ing])
);

/**
 * Per-100 g values computed from Negrita's own house recipes, replacing the
 * estimated proxies for house items. Populated at runtime from the house-recipe
 * store; empty until the restaurant defines a recipe.
 */
let houseOverrides = new Map<string, Macros>();

export function setHouseOverrides(overrides: Map<string, Macros>): void {
  houseOverrides = overrides;
}

/**
 * House items: Negrita's own preparations, whose values are estimates only the
 * restaurant's real recipe can fix. These are what the House items page lists.
 */
export function isEstimated(ingredient: Ingredient): boolean {
  return (
    ingredient.source_status === "estimated_online_proxy" ||
    ingredient.source_status === "estimated_formula"
  );
}

/**
 * Values taken from Negrita's printed DIY menu because no USDA record for the
 * actual product was verified. Distinct from house items: these are ordinary
 * foods (cheddar, watermelon) that simply need no recipe.
 */
export function isMenuStated(ingredient: Ingredient): boolean {
  return ingredient.source_status === "menu_stated";
}

/** Ingredients Negrita sells as a DIY component, so they carry a price. */
export function isPriced(ingredient: Ingredient): boolean {
  return typeof ingredient.price_idr === "number";
}

/** True once Negrita has defined a real recipe for this house item. */
export function hasHouseOverride(ingredientId: string): boolean {
  return houseOverrides.has(ingredientId);
}

export function getIngredient(id: string): Ingredient | undefined {
  const base = ingredientById.get(id);
  if (!base) return undefined;
  const override = houseOverrides.get(id);
  if (!override) return base;
  return {
    ...base,
    macros_per_100g: override,
    source_status: "negrita_recipe",
  };
}

/** All ingredients, with any house-recipe overrides applied. */
export function getAllIngredients(): Ingredient[] {
  if (houseOverrides.size === 0) return ingredients;
  return ingredients.map((ing) => getIngredient(ing.ingredient_id) ?? ing);
}

export function getRecipe(id: string): MenuRecipe | undefined {
  return menuRecipes.find((r) => r.recipe_id === id);
}

export function getUnit(
  ingredient: Ingredient,
  unitId: string
): PortionUnit | undefined {
  return ingredient.units.find((u) => u.id === unitId);
}

/** Distinct ingredient categories, sorted alphabetically. */
export const categories: string[] = Array.from(
  new Set(ingredients.map((i) => i.category))
).sort((a, b) => a.localeCompare(b));

/** Human-friendly label for a category slug, e.g. "house_sauce" → "House sauce". */
export function categoryLabel(category: string): string {
  const spaced = category.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Token-based search: every token in the query must appear somewhere in the
 * ingredient's name, category, or menu aliases. This makes partial multi-word
 * queries work the way people type them — "chick br" finds "Chicken breast".
 */
export function searchIngredients(
  query: string,
  category: string | null
): Ingredient[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const all = getAllIngredients();

  return all.filter((ing) => {
    if (category && ing.category !== category) return false;
    if (!tokens.length) return true;
    const haystack = [ing.name, ing.category, ...ing.menu_names]
      .join(" ")
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

/**
 * Ranks search results so the most likely match surfaces first: names that
 * start with the query, then names that contain it, then alias-only matches.
 */
export function rankIngredients(
  results: Ingredient[],
  query: string
): Ingredient[] {
  const q = query.trim().toLowerCase();
  if (!q) return results;
  return [...results].sort((a, b) => score(b, q) - score(a, q));
}

function score(ingredient: Ingredient, query: string): number {
  const name = ingredient.name.toLowerCase();
  if (name.startsWith(query)) return 3;
  if (name.includes(query)) return 2;
  if (ingredient.menu_names.some((n) => n.toLowerCase().includes(query))) return 1;
  return 0;
}
