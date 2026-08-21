import { getClientRepository } from "@/lib/storage";
import { DEFAULT_MEAL_SLOTS, type Client } from "@/lib/storage/types";
import { newEntity } from "@/lib/storage/entity";
import { baliWeekStart } from "@/lib/format";

/**
 * Resolving "the plan I am working on".
 *
 * The app used to keep a roster and ask you to pick a client first. A person
 * now plans their own week, so there is exactly one plan to open — and if none
 * exists yet, opening the planner creates it rather than showing an empty
 * roster the visitor has to understand before they can do anything.
 */

export const DEFAULT_PLAN_TITLE = "My week";
const DEFAULT_WEEK_COUNT = 4;

export function newPlan(title = DEFAULT_PLAN_TITLE): Client {
  return newEntity({
    name: title,
    targets: null,
    mealSlots: [...DEFAULT_MEAL_SLOTS],
    // Programs run Monday to Sunday, and "this week" means Bali's week.
    programStartDate: baliWeekStart(),
    weekCount: DEFAULT_WEEK_COUNT,
    plan: [],
  });
}

/**
 * The plan to show at /plan: the most recently touched one, or a fresh one.
 *
 * Anyone who used the old roster may have several saved clients; the newest
 * wins so their most recent work is what opens. Nothing is deleted.
 */
export async function loadCurrentPlan(): Promise<Client> {
  const repo = getClientRepository();
  const existing = await repo.latest();
  if (existing) return existing;

  const created = newPlan();
  await repo.save(created);
  return created;
}
