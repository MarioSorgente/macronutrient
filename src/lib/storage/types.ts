import type { Macros } from "@/types/nutrition";

export interface DishItem {
  ingredientId: string;
  /** Name captured at save time so reports render even if data changes later. */
  name: string;
  grams: number;
}

export interface Dish {
  id: string;
  name: string;
  items: DishItem[];
  /** Cached totals at save time (also recomputed live in the report). */
  totals: Macros;
  createdAt: string;
  updatedAt: string;
}

/**
 * Persistence contract for saved dishes. Both the localStorage implementation
 * (used now) and the Firestore implementation (prepared for later) satisfy this
 * exact interface, so swapping backends requires no changes to UI or logic.
 */
export interface DishRepository {
  list(): Promise<Dish[]>;
  get(id: string): Promise<Dish | null>;
  save(dish: Dish): Promise<Dish>;
  remove(id: string): Promise<void>;
}
