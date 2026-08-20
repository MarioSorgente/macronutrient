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
import type { Dish, DishRepository } from "@/lib/storage/types";
import { getDb } from "@/lib/storage/firebaseClient";

const COLLECTION = "dishes";

/**
 * Saved-dishes store backed by Cloud Firestore. Prepared for the future: it is
 * only instantiated when NEXT_PUBLIC_STORAGE_BACKEND=firebase and the Firebase
 * env vars are present (see getDishRepository). Implements the same
 * DishRepository contract as the localStorage backend.
 *
 * Firestore data model: collection "dishes", one document per dish keyed by
 * dish.id, storing the full Dish shape.
 */
export class FirestoreDishRepository implements DishRepository {
  async list(): Promise<Dish[]> {
    const db = getDb();
    const q = query(collection(db, COLLECTION), orderBy("updatedAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Dish);
  }

  async get(id: string): Promise<Dish | null> {
    const db = getDb();
    const snap = await getDoc(doc(db, COLLECTION, id));
    return snap.exists() ? (snap.data() as Dish) : null;
  }

  async save(dish: Dish): Promise<Dish> {
    const db = getDb();
    await setDoc(doc(db, COLLECTION, dish.id), dish);
    return dish;
  }

  async remove(id: string): Promise<void> {
    const db = getDb();
    await deleteDoc(doc(db, COLLECTION, id));
  }
}
