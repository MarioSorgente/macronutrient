import type { Assignment, Plan } from "@/lib/storage/types";

/**
 * Editing the list of meal slots without losing the meals in them.
 *
 * An assignment names its slot as a string, and every screen finds meals by
 * matching that string against `plan.mealSlots`. So renaming "Snack" to
 * "Afternoon snack" did not move the snacks — it orphaned them. They vanished
 * from the planner, stopped counting towards a complete day, and went on being
 * priced into the week and sent to the kitchen: meals nobody could see and
 * everybody was charged for.
 */

/** How many meals sit in each slot, across every week of the plan. */
export function mealsPerSlot(plan: Plan): Map<string, number> {
  const counts = new Map<string, number>();
  for (const assignment of plan.assignments) {
    counts.set(assignment.slot, (counts.get(assignment.slot) ?? 0) + 1);
  }
  return counts;
}

/**
 * Apply a set of slot renames to the meals that named the old slot.
 *
 * Keyed by the name each row started as, which the editor remembers, so a slot
 * renamed twice in one sitting still moves its meals exactly once.
 */
export function withRenamedSlots(
  assignments: Assignment[],
  renames: Map<string, string>
): Assignment[] {
  if (renames.size === 0) return assignments;
  return assignments.map((assignment) => {
    const renamed = renames.get(assignment.slot);
    return renamed && renamed !== assignment.slot
      ? { ...assignment, slot: renamed }
      : assignment;
  });
}
