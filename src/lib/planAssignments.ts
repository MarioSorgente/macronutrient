import { newAssignmentId } from "@/lib/clients";
import type { GeneratedDay } from "@/lib/mealPlanner";
import type { Assignment } from "@/lib/storage/types";

/**
 * A generated week, as the plan will store it.
 *
 * What crosses this boundary decides what a saved week can still know about
 * itself. A meal's price and macros are copied for the record, but a Negrita
 * menu dish also carries its recipe id — the identity, not the copy — because
 * the menu owns what that dish costs and contains, and re-deriving either from
 * the stored ingredient list gives a different meal.
 */
export function assignmentsFromGenerated(
  days: GeneratedDay[],
  week: number
): Assignment[] {
  return days.flatMap((day) => day.meals.map((meal) => ({
    id: newAssignmentId(),
    week,
    day: day.day,
    slot: meal.slot,
    items: meal.items,
    servings: 1,
    price: { totalIdr: meal.price.totalIdr, complete: meal.price.complete },
    snapshot: { name: meal.name, totals: meal.macros },
    ...(meal.sourceDishId ? { dishId: meal.sourceDishId } : {}),
    ...(meal.menuRecipeId ? { menuRecipeId: meal.menuRecipeId } : {}),
  })));
}
