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
/** The key a day-and-slot is held under while merging a generated week. */
export function slotKey(day: number, slot: string): string {
  return `${day} ${slot}`;
}

/**
 * The day-and-slot pairs a week already has a meal in.
 *
 * Used to merge a generated week into a part-planned one without double-booking
 * a slot.
 */
export function occupiedSlots(
  assignments: Assignment[],
  week: number
): Set<string> {
  return new Set(
    assignments
      .filter((assignment) => assignment.week === week)
      .map((assignment) => slotKey(assignment.day, assignment.slot))
  );
}

export function assignmentsFromGenerated(
  days: GeneratedDay[],
  week: number,
  /**
   * Slots to leave alone, when the generated week is being added to meals that
   * are already there rather than replacing them.
   *
   * Without this, keeping the existing week appended a full seven days on top
   * of it: every filled slot ended up with two meals, and a week the preview
   * promised at 2,200 kcal a day was saved at twice that.
   */
  keep: ReadonlySet<string> = new Set()
): Assignment[] {
  return days.flatMap((day) => day.meals
    .filter((meal) => !keep.has(slotKey(day.day, meal.slot)))
    .map((meal) => ({
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

