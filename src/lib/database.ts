import rawDatabase from "@data/negrita-database.json";
import type {
  Ingredient,
  MenuRecipe,
  NutritionDatabase,
} from "@/types/nutrition";

/**
 * The bundled Negrita database. This is static reference data (91 ingredients +
 * 25 menu recipes) shipped inside the app — no network call is needed to browse
 * ingredients or calculate macros.
 */
const database = rawDatabase as unknown as NutritionDatabase;

export const ingredients: Ingredient[] = database.ingredients;
export const menuRecipes: MenuRecipe[] = database.menu_recipes;
export const databaseMeta = {
  name: database.database_name,
  version: database.schema_version,
  generatedOn: database.generated_on,
};

const ingredientById = new Map<string, Ingredient>(
  ingredients.map((ing) => [ing.ingredient_id, ing])
);

export function getIngredient(id: string): Ingredient | undefined {
  return ingredientById.get(id);
}

export function getRecipe(id: string): MenuRecipe | undefined {
  return menuRecipes.find((r) => r.recipe_id === id);
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
 * Search ingredients by free text. Matches the display name, the category, and
 * any of the `menu_names` aliases so staff can find items by menu wording.
 */
export function searchIngredients(
  query: string,
  category: string | null
): Ingredient[] {
  const q = query.trim().toLowerCase();
  return ingredients.filter((ing) => {
    if (category && ing.category !== category) return false;
    if (!q) return true;
    if (ing.name.toLowerCase().includes(q)) return true;
    if (ing.category.toLowerCase().includes(q)) return true;
    return ing.menu_names.some((n) => n.toLowerCase().includes(q));
  });
}
