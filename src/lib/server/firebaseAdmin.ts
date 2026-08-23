import "server-only";

import {
  cert,
  getApps,
  initializeApp,
  applicationDefault,
  type App,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * The Firebase Admin SDK, for code that runs on the server.
 *
 * This is what makes the app's own API routes able to do the three things a
 * browser must never be trusted with: set a role claim, price an order, and
 * write to collections the security rules deny outright.
 *
 * `server-only` is imported for its side effect: it makes the build fail if
 * this module is ever pulled into a client component. That matters more than
 * usual here, because the credential below is a real private key — unlike the
 * NEXT_PUBLIC_FIREBASE_* values, which are public by design.
 */

/**
 * The tenant this deployment serves.
 *
 * Re-exported from the shared module rather than read again here: two copies
 * of this could drift, and a server writing to a different restaurant id than
 * the browser reads from would split the data in a way nothing would flag.
 */
export { RESTAURANT_ID } from "@/lib/firebaseEnv";

/**
 * Owner allowlist, comma-separated. A plain server env var rather than
 * NEXT_PUBLIC_, so it never reaches the browser.
 */
export function adminEmails(): string {
  return process.env.ADMIN_EMAILS ?? "";
}

/**
 * Credentials.
 *
 * On Vercel, `FIREBASE_SERVICE_ACCOUNT` holds the service-account JSON. Some
 * dashboards mangle the newlines in `private_key` when it is pasted, so those
 * are repaired rather than left to fail at sign time with an opaque error.
 *
 * Locally and in tests the emulators need no credentials at all, and asking
 * for them fails.
 */
function credential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return applicationDefault();

  let parsed: { project_id?: string; client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT is not valid JSON. Paste the whole file " +
        "contents from Firebase console → Project settings → Service accounts."
    );
  }
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email or private_key."
    );
  }
  return cert({
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key.replace(/\\n/g, "\n"),
  });
}

const EMULATED =
  Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST) ||
  Boolean(process.env.FIRESTORE_EMULATOR_HOST);

/** One app per server instance; route handlers are invoked many times over. */
function app(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  return initializeApp({
    ...(EMULATED ? {} : { credential: credential() }),
    ...(projectId ? { projectId } : {}),
  });
}

export function adminAuth(): Auth {
  return getAuth(app());
}

export function adminDb(): Firestore {
  return getFirestore(app());
}

/** True when the server has what it needs to act. Used for a clear 503. */
export function isAdminConfigured(): boolean {
  return EMULATED || Boolean(process.env.FIREBASE_SERVICE_ACCOUNT);
}
