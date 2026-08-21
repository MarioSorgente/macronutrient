/**
 * Firebase configuration read from the environment.
 *
 * Kept separate from `storage/firebaseClient` because that module statically
 * imports the Firebase SDK — roughly 120 kB. Anything that only needs to *ask*
 * whether Firebase is configured (the auth provider, the nav, the repository
 * factory) imports from here instead, so the SDK stays out of the initial
 * bundle and is fetched only when something actually talks to Firebase.
 */

export interface FirebaseConfig {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
}

/** Cloud Functions region. Jakarta is the closest region to Bali. */
export const FUNCTIONS_REGION = "asia-southeast2";

/** The tenant this deployment serves. Multi-tenant later; one value for now. */
export const RESTAURANT_ID = process.env.NEXT_PUBLIC_RESTAURANT_ID || "negrita";

export const USE_EMULATOR =
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";

/**
 * Returns null unless the essential keys are present, which is what keeps
 * Firebase dormant — and the guest planner fully working — before the app is
 * pointed at a real project.
 */
export function readFirebaseConfig(): FirebaseConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  if (!apiKey || !projectId || !appId) return null;

  return {
    apiKey,
    projectId,
    appId,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  };
}

export function isFirebaseConfigured(): boolean {
  return readFirebaseConfig() !== null;
}
