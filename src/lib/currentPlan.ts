import {
  DEFAULT_MEAL_SLOTS,
  type Plan,
  type PlanRepository,
} from "@/lib/storage/types";
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

/**
 * The id a person's first plan always gets.
 *
 * Deliberately fixed rather than random: the plan lives under
 * `users/{uid}/plans`, so one constant id is already unique per person, and
 * writing a known id makes creation idempotent. Two tabs — or React's
 * double-invoked effects in development — then converge on the same document
 * instead of each leaving behind an empty plan.
 */
export const PRIMARY_PLAN_ID = "primary";

export function newPlan(ownerUid: string | null, title = DEFAULT_PLAN_TITLE): Plan {
  const now = new Date().toISOString();
  return {
    id: PRIMARY_PLAN_ID,
    createdAt: now,
    updatedAt: now,
    ownerUid: ownerUid ?? "",
    title,
    targets: null,
    mealSlots: [...DEFAULT_MEAL_SLOTS],
    // Programs run Monday to Sunday, and "this week" means Bali's week.
    programStartDate: baliWeekStart(),
    weekCount: DEFAULT_WEEK_COUNT,
    assignments: [],
    status: "draft",
    submittedWeeks: [],
  };
}

/**
 * In-flight loads, keyed by owner. Without this, two components mounting
 * together (the planner and its report) would each miss the other's create and
 * race to write one.
 */
const inFlight = new Map<string, Promise<Plan>>();

/**
 * The plan to show at /plan: the most recently touched one, or a fresh one.
 *
 * Anyone who used the old roster may have several saved records; the newest
 * wins so their most recent work is what opens. Nothing is deleted.
 */
export function loadCurrentPlan(
  repo: PlanRepository,
  ownerUid: string | null
): Promise<Plan> {
  const key = ownerUid ?? "@guest";
  const existing = inFlight.get(key);
  if (existing) return existing;

  const pending = (async () => {
    // `latest` reads one document rather than the whole collection, which is
    // the difference between one Firestore read and one per saved plan.
    const saved = await repo.latest();
    if (saved) return saved;

    const created = newPlan(ownerUid);
    await repo.save(created);
    return created;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, pending);
  return pending;
}
