import { GRAM_UNIT_ID } from "@/types/nutrition";
import type {
  Dish,
  DishItem,
  DishRepository,
  Entity,
  HouseRecipe,
  HouseRecipeRepository,
  Plan,
  PlanRepository,
  Repository,
} from "@/lib/storage/types";
import { DEFAULT_MEAL_SLOTS } from "@/lib/storage/types";
import { createLocalRepository } from "@/lib/storage/local";
import {
  instrumentRepository,
  type StorageRequestKind,
} from "@/lib/storage/instrumentation";
import { RESTAURANT_ID, isFirebaseConfigured } from "@/lib/firebaseEnv";

export type {
  Assignment,
  Dish,
  DishItem,
  HouseRecipe,
  MacroTargets,
  Plan,
  Repository,
  Role,
  UserProfile,
} from "@/lib/storage/types";
export { DEFAULT_MEAL_SLOTS, MAX_PROGRAM_WEEKS } from "@/lib/storage/types";

/** localStorage keys. Guest data lives here and nowhere else. */
const KEYS = {
  dishes: "mamma-calories:dishes",
  // Historic key. Renaming it would orphan plans people already have saved.
  plans: "mamma-calories:clients",
  houseRecipes: "mamma-calories:house-recipes",
} as const;

/** True when the app is configured to use the cloud (Firestore) backend. */
export function isCloudBackend(): boolean {
  return (
    (process.env.NEXT_PUBLIC_STORAGE_BACKEND ?? "local") === "firebase" &&
    isFirebaseConfigured()
  );
}

/**
 * A Firestore repository whose SDK is fetched on first use.
 *
 * Every Repository method is already async, so the import can be deferred
 * without changing the contract — which keeps the Firestore SDK out of the
 * bundle for guests, who never touch it.
 */
function createLazyFirestoreRepository<T extends Entity>(
  path: string
): Repository<T> {
  let pending: Promise<Repository<T>> | null = null;
  const impl = () =>
    (pending ??= import("@/lib/storage/firebase").then((m) =>
      m.createFirestoreRepository<T>(path)
    ));

  return {
    list: async () => (await impl()).list(),
    latest: async () => (await impl()).latest(),
    get: async (id) => (await impl()).get(id),
    save: async (entity) => (await impl()).save(entity),
    remove: async (id) => (await impl()).remove(id),
  };
}

/**
 * Picks the backend for one collection and wraps it in timing instrumentation,
 * so a slow or failing read is observable rather than just felt.
 */
function createRepository<T extends Entity>(
  kind: StorageRequestKind,
  cloudPath: string | null,
  localKey: string,
  migrate?: (raw: unknown) => T | null
): Repository<T> {
  const repository = cloudPath
    ? createLazyFirestoreRepository<T>(cloudPath)
    : createLocalRepository<T>(localKey, migrate);
  if (!migrate || !cloudPath) return instrumentRepository(kind, repository);
  const migrated: Repository<T> = {
    list: async () => (await repository.list()).map(migrate).filter((x): x is T => x !== null),
    latest: async () => migrate(await repository.latest()),
    get: async (id) => migrate(await repository.get(id)),
    save: (entity) => repository.save(entity),
    remove: (id) => repository.remove(id),
  };
  return instrumentRepository(kind, migrated);
}

// --- Dishes -----------------------------------------------------------------

/**
 * Upgrades records saved before portion units existed. v1 dish items carried
 * only `grams`, so they become plain gram-based items rather than being lost.
 */
function migrateDish(raw: unknown): Dish | null {
  if (!raw || typeof raw !== "object") return null;
  const dish = raw as Partial<Dish> & { items?: unknown };
  if (!dish.id || !Array.isArray(dish.items)) return null;

  const items: DishItem[] = dish.items.map((entry) => {
    const item = entry as Partial<DishItem>;
    const grams = typeof item.grams === "number" ? item.grams : 0;
    return {
      ingredientId: String(item.ingredientId ?? ""),
      name: String(item.name ?? ""),
      grams,
      unitId: item.unitId ?? GRAM_UNIT_ID,
      quantity: typeof item.quantity === "number" ? item.quantity : grams,
    };
  });

  return { ...(dish as Dish), items };
}

// --- Plans ------------------------------------------------------------------

/**
 * Fills in defaults so partially-shaped records stay usable, and upgrades the
 * pre-account shape: what used to be a coach's `Client` (with `name` and
 * `plan`) becomes the owner's own `Plan` (with `title` and `assignments`).
 */
export function migratePlan(raw: unknown): Plan | null {
  if (!raw || typeof raw !== "object") return null;
  const legacy = raw as Partial<Plan> & { name?: string; plan?: unknown };
  if (!legacy.id) return null;

  const assignments = Array.isArray(legacy.assignments)
    ? legacy.assignments
    : Array.isArray(legacy.plan)
    ? (legacy.plan as Plan["assignments"])
    : [];

  // Timestamps are not cosmetic here: `latest()` orders on `updatedAt`, and a
  // record without one is either invisible to the Firestore query or poisons
  // the local reduce (every `value > undefined` comparison is false, so the
  // first such record wins forever). A legacy roster record is exactly the case
  // this function exists for, so it must not leave them unset. The epoch is the
  // honest default: it says "older than anything real", which is what an
  // undated record is.
  const epoch = new Date(0).toISOString();
  const targetMode = legacy.targetMode === "preset" || legacy.targetMode === "custom"
    ? legacy.targetMode
    // Old complete targets may have been edited while a style card stayed
    // selected, so custom is the only migration that never claims a preset.
    : legacy.targets ? "custom" : "preset";
  const legacyPreset = legacy.targetPreset ?? legacy.preferences?.macroStyle ?? "balanced";
  return {
    ...(legacy as Plan),
    createdAt: legacy.createdAt ?? epoch,
    updatedAt: legacy.updatedAt ?? legacy.createdAt ?? epoch,
    ownerUid: legacy.ownerUid ?? "",
    title: legacy.title ?? legacy.name ?? "My week",
    targets: legacy.targets ?? null,
    targetMode,
    ...(targetMode === "preset" ? { targetPreset: legacyPreset } : { targetPreset: undefined }),
    mealSlots:
      Array.isArray(legacy.mealSlots) && legacy.mealSlots.length
        ? legacy.mealSlots
        : [...DEFAULT_MEAL_SLOTS],
    weekCount: legacy.weekCount ?? 4,
    assignments,
    status: legacy.status ?? "draft",
    submittedWeeks: Array.isArray(legacy.submittedWeeks)
      ? legacy.submittedWeeks
      : [],
  };
}

// --- Factories --------------------------------------------------------------
//
// Repositories are keyed by uid rather than being module singletons, because
// which store a component talks to depends on who is signed in. `null` means
// "this device": nothing writes to it any more — the planner needs an account —
// but it is still where a week built before that requirement is claimed from.

const planRepos = new Map<string, PlanRepository>();
const dishRepos = new Map<string, DishRepository>();

const GUEST = "@guest";

export function getPlanRepository(uid: string | null): PlanRepository {
  const key = uid ?? GUEST;
  let repo = planRepos.get(key);
  if (!repo) {
    repo = createRepository<Plan>(
      "plan",
      uid && isCloudBackend() ? `users/${uid}/plans` : null,
      KEYS.plans,
      migratePlan
    );
    planRepos.set(key, repo);
  }
  return repo;
}

export function getDishRepository(uid: string | null): DishRepository {
  const key = uid ?? GUEST;
  let repo = dishRepos.get(key);
  if (!repo) {
    repo = createRepository<Dish>(
      "dish",
      uid && isCloudBackend() ? `users/${uid}/dishes` : null,
      KEYS.dishes,
      migrateDish
    );
    dishRepos.set(key, repo);
  }
  return repo;
}

let houseRecipeRepo: HouseRecipeRepository | null = null;

/**
 * House recipes belong to the restaurant, not to a person: they correct the
 * macros everyone sees, guests included, so they come from the shared
 * restaurant document rather than from anyone's account.
 */
export function getHouseRecipeRepository(): HouseRecipeRepository {
  if (!houseRecipeRepo) {
    houseRecipeRepo = createRepository<HouseRecipe>(
      "house-recipe",
      isCloudBackend() ? `restaurants/${RESTAURANT_ID}/houseRecipes` : null,
      KEYS.houseRecipes
    );
  }
  return houseRecipeRepo;
}

/** The device's guest stores, for claiming that work into a new account. */
export const guestStores = {
  plans: (): PlanRepository =>
    createLocalRepository<Plan>(KEYS.plans, migratePlan),
  dishes: (): DishRepository =>
    createLocalRepository<Dish>(KEYS.dishes, migrateDish),
  clear(): void {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(KEYS.plans);
    window.localStorage.removeItem(KEYS.dishes);
  },
};
