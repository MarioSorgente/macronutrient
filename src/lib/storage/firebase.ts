import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import type { Entity, Repository } from "@/lib/storage/types";
import { getDb } from "@/lib/storage/firebaseClient";

/**
 * Builds a Repository backed by Cloud Firestore: one collection, one document
 * per entity keyed by its id.
 *
 * Prepared for later — only used when NEXT_PUBLIC_STORAGE_BACKEND=firebase and
 * the Firebase env vars are present (see getRepository). Importing this module
 * runs no code; Firebase initialises lazily on the first getDb() call.
 */
export function createFirestoreRepository<T extends Entity>(
  collectionName: string
): Repository<T> {
  return {
    async list() {
      const db = getDb();
      const q = query(
        collection(db, collectionName),
        orderBy("updatedAt", "desc")
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as T);
    },

    async get(id) {
      const db = getDb();
      const snap = await getDoc(doc(db, collectionName, id));
      return snap.exists() ? (snap.data() as T) : null;
    },

    async save(entity) {
      const db = getDb();
      await setDoc(doc(db, collectionName, entity.id), entity);
      return entity;
    },

    async remove(id) {
      const db = getDb();
      await deleteDoc(doc(db, collectionName, id));
    },
  };
}
