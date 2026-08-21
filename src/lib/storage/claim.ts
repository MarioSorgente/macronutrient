import {
  getDishRepository,
  getPlanRepository,
  guestStores,
  isCloudBackend,
} from "@/lib/storage";
import { touch } from "@/lib/storage/entity";

export interface ClaimResult {
  plans: number;
  dishes: number;
}

/**
 * Moves the work done on this device into a newly signed-in account.
 *
 * Someone can plan a whole week before deciding to make an account. Losing that
 * at the moment they commit would be the worst possible time to lose it, so the
 * guest store is copied up and only cleared once every write has succeeded.
 *
 * Safe to call on every sign-in: with nothing stored it does nothing, and it
 * never overwrites cloud records that already exist for the same id.
 */
export async function claimGuestData(uid: string): Promise<ClaimResult> {
  if (!uid || !isCloudBackend()) return { plans: 0, dishes: 0 };

  const [guestPlans, guestDishes] = await Promise.all([
    guestStores.plans().list(),
    guestStores.dishes().list(),
  ]);
  if (guestPlans.length === 0 && guestDishes.length === 0) {
    return { plans: 0, dishes: 0 };
  }

  const plans = getPlanRepository(uid);
  const dishes = getDishRepository(uid);

  // Anything already in the account wins: a second device signing in must not
  // overwrite the plan the first one saved.
  const [existingPlans, existingDishes] = await Promise.all([
    plans.list(),
    dishes.list(),
  ]);
  const havePlan = new Set(existingPlans.map((p) => p.id));
  const haveDish = new Set(existingDishes.map((d) => d.id));

  const newPlans = guestPlans.filter((p) => !havePlan.has(p.id));
  const newDishes = guestDishes.filter((d) => !haveDish.has(d.id));

  await Promise.all([
    ...newPlans.map((plan) => plans.save(touch({ ...plan, ownerUid: uid }))),
    ...newDishes.map((dish) => dishes.save(touch(dish))),
  ]);

  // Only now is it safe to let go of the device copy.
  guestStores.clear();

  return { plans: newPlans.length, dishes: newDishes.length };
}
