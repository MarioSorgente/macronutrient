import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { readFirebaseConfig } from "@/lib/firebaseEnv";

/**
 * The Firebase app instance, and nothing else.
 *
 * Each service lives in its own module — Firestore, Auth and Functions are
 * separate SDK entry points, and a module that imports all three forces every
 * consumer to download all three. The dish repository needs Firestore only; the
 * sign-in form needs Auth only.
 */
let cachedApp: FirebaseApp | null = null;

export function getApp(): FirebaseApp {
  if (cachedApp) return cachedApp;
  const config = readFirebaseConfig();
  if (!config) {
    throw new Error(
      "Firebase is not configured — set the NEXT_PUBLIC_FIREBASE_* env vars."
    );
  }
  cachedApp = getApps().length ? getApps()[0] : initializeApp(config);
  return cachedApp;
}
