import type { DishRepository } from "@/lib/storage/types";
import { LocalStorageDishRepository } from "@/lib/storage/local";
import { FirestoreDishRepository } from "@/lib/storage/firebase";
import { isFirebaseConfigured } from "@/lib/storage/firebaseClient";

export type { Dish, DishItem, DishRepository } from "@/lib/storage/types";

let cached: DishRepository | null = null;

/**
 * Returns the active saved-dishes backend. Defaults to localStorage. Only when
 * NEXT_PUBLIC_STORAGE_BACKEND is "firebase" AND the Firebase config is present
 * is the Firestore backend used. Importing FirestoreDishRepository runs no code;
 * Firebase only initialises when a repository method actually calls getDb().
 */
export function getDishRepository(): DishRepository {
  if (cached) return cached;
  cached = isCloudBackend()
    ? new FirestoreDishRepository()
    : new LocalStorageDishRepository();
  return cached;
}

/** True when the app is configured to use the cloud (Firestore) backend. */
export function isCloudBackend(): boolean {
  return (
    (process.env.NEXT_PUBLIC_STORAGE_BACKEND ?? "local") === "firebase" &&
    isFirebaseConfigured()
  );
}
