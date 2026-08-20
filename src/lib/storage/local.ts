import type { Dish, DishRepository } from "@/lib/storage/types";

const STORAGE_KEY = "mamma-calories:dishes";

/**
 * Saved-dishes store backed by the browser's localStorage. Works with zero
 * configuration and no external services; dishes live on the device that
 * created them. Implements the same DishRepository contract as the Firestore
 * backend so it can be swapped out later.
 */
export class LocalStorageDishRepository implements DishRepository {
  private read(): Dish[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Dish[]) : [];
    } catch {
      return [];
    }
  }

  private write(dishes: Dish[]): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dishes));
  }

  async list(): Promise<Dish[]> {
    return this.read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Dish | null> {
    return this.read().find((d) => d.id === id) ?? null;
  }

  async save(dish: Dish): Promise<Dish> {
    const dishes = this.read();
    const index = dishes.findIndex((d) => d.id === dish.id);
    if (index >= 0) {
      dishes[index] = dish;
    } else {
      dishes.push(dish);
    }
    this.write(dishes);
    return dish;
  }

  async remove(id: string): Promise<void> {
    this.write(this.read().filter((d) => d.id !== id));
  }
}
