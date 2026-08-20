import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

/**
 * Reads the Firebase web config from NEXT_PUBLIC_FIREBASE_* env vars. Returns
 * null unless the essential keys are present, which keeps Firebase completely
 * dormant until the app is intentionally pointed at a real project.
 */
function readConfig() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  if (!config.apiKey || !config.projectId || !config.appId) return null;
  return config;
}

export function isFirebaseConfigured(): boolean {
  return readConfig() !== null;
}

let cachedDb: Firestore | null = null;

/**
 * Lazily initialises the Firebase app + Firestore the first time it is needed.
 * Throws a clear error if called without configuration so misconfiguration is
 * obvious rather than silent.
 */
export function getDb(): Firestore {
  if (cachedDb) return cachedDb;
  const config = readConfig();
  if (!config) {
    throw new Error(
      "Firebase backend selected but NEXT_PUBLIC_FIREBASE_* env vars are missing."
    );
  }
  const app: FirebaseApp = getApps().length
    ? getApps()[0]
    : initializeApp(config);
  cachedDb = getFirestore(app);
  return cachedDb;
}
