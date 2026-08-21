import {
  getFirestore,
  connectFirestoreEmulator,
  type Firestore,
} from "firebase/firestore";
import { getApp } from "@/lib/storage/firebaseApp";
import { USE_EMULATOR } from "@/lib/firebaseEnv";

/**
 * Cloud Firestore access.
 *
 * Auth and Functions live in sibling modules so importing the database does not
 * also pull their SDKs into the bundle. Callers that only need to know whether
 * Firebase is configured should import `@/lib/firebaseEnv`, which pulls no SDK
 * at all.
 */
export { RESTAURANT_ID, isFirebaseConfigured } from "@/lib/firebaseEnv";

let cachedDb: Firestore | null = null;

export function getDb(): Firestore {
  if (cachedDb) return cachedDb;
  cachedDb = getFirestore(getApp());
  if (USE_EMULATOR) connectFirestoreEmulator(cachedDb, "127.0.0.1", 8080);
  return cachedDb;
}
