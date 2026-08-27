import {
  DEFAULT_MEAL_SLOTS,
  type Plan,
  type PlanRepository,
} from "@/lib/storage/types";
import { touch } from "@/lib/storage/entity";
import { baliWeekStart } from "@/lib/format";

/**
 * Resolving "the plan I am working on", and getting it safely written back.
 *
 * The app used to keep a roster and ask you to pick a client first. A person
 * now plans their own week, so there is exactly one plan to open — and if none
 * exists yet, opening the planner creates it rather than showing an empty
 * roster the visitor has to understand before they can do anything.
 *
 * Reads and writes live in the same module because they share one piece of
 * state: what this session has most recently written for an owner. A read can
 * only ever be as fresh as the last write to land, and "I found nothing" is not
 * proof that nothing is there.
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
    targetMode: "preset",
    targetPreset: "balanced",
    mealSlots: [...DEFAULT_MEAL_SLOTS],
    // Programs run Monday to Sunday, and "this week" means Bali's week.
    programStartDate: baliWeekStart(),
    weekCount: DEFAULT_WEEK_COUNT,
    assignments: [],
    status: "draft",
    submittedWeeks: [],
  };
}

export function planOwnerKey(ownerUid: string | null): string {
  return ownerUid ?? "@guest";
}

/**
 * In-flight loads, keyed by owner. Without this, two components mounting
 * together (the planner and its report) would each miss the other's create and
 * race to write one.
 */
const inFlight = new Map<string, Promise<Plan>>();

/**
 * What this session knows about an owner's plan, and the write carrying it.
 *
 * `latest` is the newest plan we have loaded or been asked to save. `tail`
 * serialises writes so an older plan can never reach the backend after a newer
 * one — FIFO by construction, on every backend, rather than relying on
 * millisecond-resolution timestamps for correctness. `tail` never rejects, so
 * chaining onto it cannot produce an unhandled rejection; failures are recorded
 * on `error` and re-thrown to whoever called `savePlan`.
 */
interface PlanWrites {
  latest: Plan;
  tail: Promise<void>;
  error: unknown | null;
}

const writes = new Map<string, PlanWrites>();

function remember(key: string, plan: Plan): void {
  const current = writes.get(key);
  if (current) {
    if (plan.updatedAt >= current.latest.updatedAt) current.latest = plan;
    return;
  }
  writes.set(key, { latest: plan, tail: Promise.resolve(), error: null });
}

/**
 * Saves a plan, serialised per owner, newest last.
 *
 * Stamps with `touch()` here so no caller has to remember that neither
 * repository stamps for them — the Firestore one writes the entity verbatim,
 * and an unstamped record is invisible to the `orderBy("updatedAt")` query that
 * finds it again. Rejects with the underlying failure, because the whole point
 * is that a save which did not happen must be sayable on screen.
 */
export function savePlan(
  repo: PlanRepository,
  ownerUid: string | null,
  plan: Plan
): Promise<Plan> {
  const key = planOwnerKey(ownerUid);
  const stamped = touch(plan);
  const previous = writes.get(key);
  const queued = (previous?.tail ?? Promise.resolve()).then(() => repo.save(stamped));

  writes.set(key, {
    latest: stamped,
    tail: queued.then(
      () => {
        // Only the newest write clears the flag: an older one succeeding says
        // nothing about whether the newest made it.
        const current = writes.get(key);
        if (current?.latest === stamped) current.error = null;
      },
      (cause) => {
        const current = writes.get(key);
        if (current) current.error = cause;
      }
    ),
    error: previous?.error ?? null,
  });

  return queued.then(() => stamped);
}

/** The newest plan this session has loaded or written for an owner. */
export function lastKnownPlan(ownerUid: string | null): Plan | null {
  return writes.get(planOwnerKey(ownerUid))?.latest ?? null;
}

/** The last save failure for an owner, or null once a newer write succeeds. */
export function lastSaveError(ownerUid: string | null): unknown | null {
  return writes.get(planOwnerKey(ownerUid))?.error ?? null;
}

/** Resolves once every queued write for this owner has settled, ok or not. */
export function whenPlanWritesSettle(ownerUid: string | null): Promise<void> {
  return writes.get(planOwnerKey(ownerUid))?.tail ?? Promise.resolve();
}

/** Test seam. Session state is module-level by design; tests need it cleared. */
export function __resetPlanCache(): void {
  inFlight.clear();
  writes.clear();
}

/** Whether moving the program anchor cannot change any planned service date. */
export function isUntouchedDraft(plan: Plan): boolean {
  return plan.status === "draft" &&
    plan.assignments.length === 0 &&
    (plan.submittedWeeks?.length ?? 0) === 0;
}

/** The 1-based program week containing a Bali calendar date, if any. */
export function programWeekForDate(plan: Plan, date: string): number | null {
  const start = Date.parse(`${plan.programStartDate}T00:00:00Z`);
  const target = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(target)) return null;
  const week = Math.floor((target - start) / (7 * 86_400_000)) + 1;
  return week >= 1 && week <= plan.weekCount ? week : null;
}

/**
 * The plan to show at /plan: the most recently touched one, or a fresh one.
 *
 * Anyone who used the old roster may have several saved records; the newest
 * wins so their most recent work is what opens. Nothing is deleted — and that
 * last part used not to be true. Creating a plan writes `newPlan()` to the
 * fixed `primary` id, and both backends save by full replacement, so answering
 * an empty read with a create destroyed whatever was really there. An empty
 * read is not proof: an offline Firestore read is served from an empty memory
 * cache, and a record with no `updatedAt` is invisible to the ordered query
 * that looks for it. So creation is now the last resort, after asking for the
 * known id directly.
 */
export function loadCurrentPlan(
  repo: PlanRepository,
  ownerUid: string | null
): Promise<Plan> {
  const key = planOwnerKey(ownerUid);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const pending = (async () => {
    // A write we issued this session is newer than anything a read can return.
    // Draining first is what stops a tab switch mid-save from showing the
    // pre-apply week.
    await whenPlanWritesSettle(ownerUid);

    // `latest` reads one document rather than the whole collection, which is
    // the difference between one Firestore read and one per saved plan.
    const saved = await repo.latest();
    const mine = writes.get(key)?.latest ?? null;

    // Newest wins, and on a tie ours does: it is at least as new, and if its
    // save failed it is the only copy of the week that exists anywhere.
    let loaded: Plan | null = null;
    if (mine && (!saved || mine.updatedAt >= saved.updatedAt)) loaded = mine;
    if (saved) {
      if (!loaded) loaded = saved;
    }
    if (!loaded && mine) loaded = mine;

    if (loaded) {
      const thisWeek = baliWeekStart();
      if (loaded.programStartDate < thisWeek && isUntouchedDraft(loaded)) {
        loaded = await savePlan(repo, ownerUid, {
          ...loaded,
          programStartDate: thisWeek,
        });
      } else {
        remember(key, loaded);
      }
      return loaded;
    }

    const atPrimary = await repo.get(PRIMARY_PLAN_ID);
    if (atPrimary) {
      const thisWeek = baliWeekStart();
      if (atPrimary.programStartDate < thisWeek && isUntouchedDraft(atPrimary)) {
        return savePlan(repo, ownerUid, { ...atPrimary, programStartDate: thisWeek });
      }
      remember(key, atPrimary);
      return atPrimary;
    }

    const created = newPlan(ownerUid);
    await repo.save(created);
    remember(key, created);
    return created;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, pending);
  return pending;
}
