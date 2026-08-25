import { getIngredient, getRecipe, menuRecipes } from "@/lib/database";
import type { MenuRecipe } from "@/types/nutrition";
import type { Assignment, DishItem } from "@/lib/storage/types";

/**
 * Which Negrita menu dish a planned meal *is*.
 *
 * A menu dish is sold at a price the restaurant sets and counted on the macros
 * the menu publishes. Both are facts about the dish, not about the copy of it
 * sitting in someone's plan, so a plan stores the identity and looks the rest
 * up. The alternative — storing a price and an ingredient list and re-deriving
 * from those — is what let a Rp 89,000 pancake be quoted at Rp 15,000 and
 * counted as 1,139 kcal when the menu, and the planner that chose it, both say
 * 1,095.
 *
 * The gram quantities are a fit to the published macros rather than the recipe
 * the kitchen works from, so adding the components up is a different number by
 * 3-11% on calories and up to 11% on protein. They are there for the kitchen
 * and for display, and they are never the source of truth for a menu dish.
 */
export function assignmentMenuRecipe(
  assignment: Pick<Assignment, "menuRecipeId">
): MenuRecipe | undefined {
  return assignment.menuRecipeId ? getRecipe(assignment.menuRecipeId) : undefined;
}

/** Names differ only in case and padding between the menu and a snapshot. */
function normalizedName(name: string | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

/** The components a planner candidate would have built from this recipe. */
function recipeItems(recipe: MenuRecipe): { ingredientId: string; grams: number }[] {
  return recipe.components.flatMap((component) =>
    component.quantity_g != null && getIngredient(component.ingredient_id)
      ? [{ ingredientId: component.ingredient_id, grams: component.quantity_g }]
      : []);
}

/** Whether an ingredient list is this recipe's, to the gram. */
function isRecipeItemList(recipe: MenuRecipe, items: DishItem[]): boolean {
  const expected = recipeItems(recipe);
  if (!expected.length || expected.length !== items.length) return false;
  const grams = new Map(items.map((item) => [item.ingredientId, item.grams]));
  return expected.every((component) => {
    const planned = grams.get(component.ingredientId);
    // The quantities are fitted to a tenth of a gram; anything hand-built lands
    // somewhere else entirely, so this is an equality check with room only for
    // floating point.
    return planned !== undefined && Math.abs(planned - component.grams) < 0.05;
  });
}

/**
 * Give a meal planned before menu identity existed its identity back.
 *
 * Only where it is beyond doubt: one menu dish of that name, and an ingredient
 * list that is that recipe's to the gram. A meal built by hand from a menu
 * template and then adjusted fails the second test and stays what it is — a
 * meal made of its components, priced and counted as such.
 *
 * Name matching lives here and only here, as a one-time upgrade. Once the id is
 * written the plan carries it, and nothing downstream ever matches on a name.
 */
export function withMenuIdentity(assignment: Assignment): Assignment {
  if (assignment.menuRecipeId || assignment.dishId) return assignment;
  const items = assignment.items;
  if (!items?.length) return assignment;

  const wanted = normalizedName(assignment.snapshot?.name);
  if (!wanted) return assignment;
  // Two dishes of the same name would make this a guess rather than a match.
  const named = menuRecipes.filter((recipe) => normalizedName(recipe.name) === wanted);
  if (named.length !== 1 || !isRecipeItemList(named[0], items)) return assignment;

  return { ...assignment, menuRecipeId: named[0].recipe_id };
}
