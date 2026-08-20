import { GRAM_UNIT_ID } from "@/types/nutrition";
import type {
  Client,
  ClientRepository,
  Dish,
  DishItem,
  DishRepository,
  Entity,
  HouseRecipe,
  HouseRecipeRepository,
  Repository,
} from "@/lib/storage/types";
import { DEFAULT_MEAL_SLOTS } from "@/lib/storage/types";
import { createLocalRepository } from "@/lib/storage/local";
import { createFirestoreRepository } from "@/lib/storage/firebase";
import { isFirebaseConfigured } from "@/lib/storage/firebaseClient";

export type {
  Assignment,
  Client,
  Dish,
  DishItem,
  HouseRecipe,
  MacroTargets,
  Repository,
} from "@/lib/storage/types";
export { DEFAULT_MEAL_SLOTS, MAX_PROGRAM_WEEKS } from "@/lib/storage/types";

const KEYS = {
  dishes: "mamma-calories:dishes",
  clients: "mamma-calories:clients",
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
 * Picks the active backend for a collection. Defaults to localStorage; uses
 * Firestore only when the backend is selected AND Firebase config is present.
 */
function createRepository<T extends Entity>(
  key: keyof typeof KEYS,
  migrate?: (raw: unknown) => T | null
): Repository<T> {
  return isCloudBackend()
    ? createFirestoreRepository<T>(key)
    : createLocalRepository<T>(KEYS[key], migrate);
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

let dishRepo: DishRepository | null = null;

export function getDishRepository(): DishRepository {
  if (!dishRepo) dishRepo = createRepository<Dish>("dishes", migrateDish);
  return dishRepo;
}

// --- Clients ----------------------------------------------------------------

/** Fills in defaults so partially-shaped client records stay usable. */
function migrateClient(raw: unknown): Client | null {
  if (!raw || typeof raw !== "object") return null;
  const client = raw as Partial<Client>;
  if (!client.id) return null;
  return {
    ...(client as Client),
    targets: client.targets ?? null,
    mealSlots:
      Array.isArray(client.mealSlots) && client.mealSlots.length
        ? client.mealSlots
        : [...DEFAULT_MEAL_SLOTS],
    weekCount: client.weekCount ?? 4,
    plan: Array.isArray(client.plan) ? client.plan : [],
  };
}

let clientRepo: ClientRepository | null = null;

export function getClientRepository(): ClientRepository {
  if (!clientRepo) clientRepo = createRepository<Client>("clients", migrateClient);
  return clientRepo;
}

// --- House recipes ----------------------------------------------------------

let houseRecipeRepo: HouseRecipeRepository | null = null;

export function getHouseRecipeRepository(): HouseRecipeRepository {
  if (!houseRecipeRepo) {
    houseRecipeRepo = createRepository<HouseRecipe>("houseRecipes");
  }
  return houseRecipeRepo;
}
