import {
  getDishRepository,
  getPlanRepository,
  guestStores,
  isCloudBackend,
} from "@/lib/storage";
import { touch } from "@/lib/storage/entity";
import { whileClaiming } from "@/lib/currentPlan";
import type { Plan } from "@/lib/storage/types";

export interface ClaimResult {
  plans: number;
  dishes: number;
}

/** A plan the planner created on sign-in but nobody has put anything in yet. */
function isEmpty(plan: Plan): boolean {
  return (plan.assignments?.length ?? 0) === 0;
}

/**
 * Moves the work done on this device into a newly signed-in account.
 *
 * Someone can plan a whole week before deciding to make an account. Losing that
 * at the moment they commit would be the worst possible time to lose it, so the
 * guest store is copied up and only cleared once every write has succeeded.
 *
 * Id collisions are the subtle part. A guest plan carries the same fixed
 * `primary` id the planner uses, and the planner may have already created an
 * empty plan under it while this was running — both react to the same sign-in.
 * So a collision is resolved by looking at what is actually there rather than
 * by skipping: an empty plan is replaced, a real one is kept and the guest's
 * week is filed alongside it under a fresh id.
 */
export function claimGuestData(uid: string): Promise<ClaimResult> {
  if (!uid || !isCloudBackend()) return Promise.resolve({ plans: 0, dishes: 0 });
  // Held from before the read to after the last write. `loadCurrentPlan` creates
  // at the same fixed `primary` id with a plain replace, and it reacts to the
  // same sign-in this does — so without the barrier its empty plan could land on
  // top of the claimed week, moments after `guestStores.clear()` below deleted
  // the only other copy of it.
  return whileClaiming(uid, () => claim(uid));
}

async function claim(uid: string): Promise<ClaimResult> {
  const [guestPlans, guestDishes] = await Promise.all([
    guestStores.plans().list(),
    guestStores.dishes().list(),
  ]);
  if (guestPlans.length === 0 && guestDishes.length === 0) {
    return { plans: 0, dishes: 0 };
  }

  const plans = getPlanRepository(uid);
  const dishes = getDishRepository(uid);

  const [existingPlans, existingDishes] = await Promise.all([
    plans.list(),
    dishes.list(),
  ]);
  const planById = new Map(existingPlans.map((p) => [p.id, p]));
  const haveDish = new Set(existingDishes.map((d) => d.id));

  const writes: Promise<unknown>[] = [];
  let claimedPlans = 0;

  for (const guest of guestPlans) {
    // Nothing on the device worth moving.
    if (isEmpty(guest)) continue;

    const collision = planById.get(guest.id);
    const takesPrimary = !collision || isEmpty(collision);
    const target = takesPrimary
      ? guest.id // free, or an empty placeholder we can replace
      : newId(); // a real plan lives here — keep both

    // Filing a guest week alongside a real account plan must not promote it.
    // `touch()` here stamped the older week as the newest thing in the
    // collection, so the next load — which picks by `updatedAt` — opened the
    // guest's week instead of the account's own. Keep its real age; only stamp
    // when it has none, or when it is genuinely taking over the primary id.
    const claimed = { ...guest, id: target, ownerUid: uid };
    writes.push(plans.save(
      takesPrimary || !claimed.updatedAt ? touch(claimed) : claimed
    ));
    claimedPlans += 1;
  }

  // Dish ids are random, so a collision means this dish was already claimed.
  const newDishes = guestDishes.filter((d) => !haveDish.has(d.id));
  writes.push(...newDishes.map((dish) => dishes.save(touch(dish))));

  await Promise.all(writes);

  // Only now is it safe to let go of the device copy.
  guestStores.clear();

  return { plans: claimedPlans, dishes: newDishes.length };
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `p-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
