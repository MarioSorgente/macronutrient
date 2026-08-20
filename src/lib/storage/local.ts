import type { Entity, Repository } from "@/lib/storage/types";

/**
 * Builds a Repository backed by the browser's localStorage. Works with zero
 * configuration; records live on the device that created them.
 *
 * `migrate` runs on every read, letting older saved records be upgraded to the
 * current shape without a destructive rewrite.
 */
export function createLocalRepository<T extends Entity>(
  storageKey: string,
  migrate?: (raw: unknown) => T | null
): Repository<T> {
  function read(): T[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const items = migrate
        ? parsed.map(migrate).filter((x): x is T => x !== null)
        : (parsed as T[]);
      return items;
    } catch {
      return [];
    }
  }

  function write(items: T[]): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(items));
  }

  return {
    async list() {
      return read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async get(id) {
      return read().find((item) => item.id === id) ?? null;
    },

    async save(entity) {
      const items = read();
      const index = items.findIndex((item) => item.id === entity.id);
      if (index >= 0) {
        items[index] = entity;
      } else {
        items.push(entity);
      }
      write(items);
      return entity;
    },

    async remove(id) {
      write(read().filter((item) => item.id !== id));
    },
  };
}
