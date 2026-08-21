import type { Entity } from "@/lib/storage/types";

/**
 * Creating and stamping persisted records.
 *
 * Four components were each doing `crypto.randomUUID()` plus two
 * `new Date().toISOString()` calls inline, which is how `createdAt` and
 * `updatedAt` end up milliseconds apart on a brand-new record for no reason.
 */

/** A fresh entity: new id, both timestamps identical. */
export function newEntity<T extends object>(fields: T): T & Entity {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...fields };
}

/** Marks an existing entity as changed, leaving `createdAt` alone. */
export function touch<T extends Entity>(entity: T): T {
  return { ...entity, updatedAt: new Date().toISOString() };
}
