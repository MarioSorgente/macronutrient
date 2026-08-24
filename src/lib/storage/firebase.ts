import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import type { Entity, Repository } from "@/lib/storage/types";
import { getDb } from "@/lib/storage/firebaseClient";

/**
 * Drops keys whose value is `undefined`, at any depth.
 *
 * The two backends disagree about what an absent optional field looks like.
 * `localStorage` goes through JSON, which silently drops `undefined`; Firestore
 * rejects the whole write with "Unsupported field value: undefined". So a
 * record the local repository accepts could fail against the cloud one, and the
 * app is full of `notes: value || undefined` — plan settings saved with an
 * empty Notes box failed every time, and the planner could only report that it
 * "could not save your plan".
 *
 * Dropping the key rather than writing null keeps the two backends reading back
 * the same shape: an absent optional field.
 */
function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => withoutUndefined(item)) as unknown as T;
  }
  // Only plain objects: a Date or a Firestore sentinel must pass through whole.
  if (value === null || typeof value !== "object") return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) continue;
    out[key] = withoutUndefined(item);
  }
  return out as T;
}

/**
 * A Repository backed by Cloud Firestore: one document per entity, keyed by id.
 *
 * Takes a full collection *path* rather than a name, so the same code serves a
 * top-level collection and a per-user subcollection. That is what lets a plan
 * live at `users/{uid}/plans` — private to its owner by construction, rather
 * than by a rule that has to filter a shared collection.
 */
export function createFirestoreRepository<T extends Entity>(
  path: string
): Repository<T> {
  return {
    async list() {
      const snap = await getDocs(
        query(collection(getDb(), path), orderBy("updatedAt", "desc"))
      );
      return snap.docs.map((d) => d.data() as T);
    },

    /** One document, not the whole collection — the read the planner makes. */
    async latest() {
      const snap = await getDocs(
        query(collection(getDb(), path), orderBy("updatedAt", "desc"), limit(1))
      );
      const newest = snap.docs[0];
      return newest ? (newest.data() as T) : null;
    },

    async get(id) {
      const snap = await getDoc(doc(getDb(), path, id));
      return snap.exists() ? (snap.data() as T) : null;
    },

    async save(entity) {
      await setDoc(doc(getDb(), path, entity.id), withoutUndefined(entity));
      // The caller keeps the record it passed in, undefined keys and all —
      // stripping them is how Firestore stores an absent field, not a change
      // to the value the app is holding.
      return entity;
    },

    async remove(id) {
      await deleteDoc(doc(getDb(), path, id));
    },
  };
}
