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
      await setDoc(doc(getDb(), path, entity.id), entity);
      return entity;
    },

    async remove(id) {
      await deleteDoc(doc(getDb(), path, id));
    },
  };
}
