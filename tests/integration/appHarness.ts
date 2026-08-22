import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from "firebase/functions";
import { PROJECT_ID } from "./helpers";

/**
 * A real Firebase client pointed at the emulator suite.
 *
 * The Cloud Functions are called the way the browser calls them — through
 * `httpsCallable` with a real ID token — because the point of these tests is
 * the boundary, not the function body. Anything the rules would deny is
 * seeded through the emulator's REST API instead, which is what the Admin SDK
 * effectively does in production.
 */

/** Must match functions/src/config.ts. */
export const REGION = "asia-southeast2";
export const RESTAURANT_ID = "negrita";

const AUTH_HOST = "127.0.0.1:9099";
const FIRESTORE_HOST = "127.0.0.1:8080";

export interface Harness {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  functions: Functions;
  call: <Req, Res>(name: string, data: Req) => Promise<Res>;
  signUp: (email: string, password?: string) => Promise<User>;
  dispose: () => Promise<void>;
}

let instance = 0;

export function createHarness(): Harness {
  const app = initializeApp(
    { projectId: PROJECT_ID, apiKey: "emulator-key", appId: "1:1:web:1" },
    `harness-${(instance += 1)}`
  );

  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });

  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);

  const functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);

  return {
    app,
    auth,
    db,
    functions,
    call: async <Req, Res>(name: string, data: Req): Promise<Res> => {
      const result = await httpsCallable<Req, Res>(functions, name)(data);
      return result.data;
    },
    signUp: async (email, password = "password123") => {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      return credential.user;
    },
    dispose: async () => {
      await signOut(auth).catch(() => {});
      await deleteApp(app);
    },
  };
}

// --- Emulator admin operations ---------------------------------------------
//
// These use the emulators' own REST surfaces. The Firestore emulator treats
// `Authorization: Bearer owner` as the Admin SDK and skips rules entirely,
// which is how production writes an order. Node's built-in fetch does not read
// HTTPS_PROXY, so these reach loopback directly.

/** Tells the Firestore emulator to bypass security rules, as the Admin SDK does. */
const ADMIN_HEADERS = { authorization: "Bearer owner" } as const;

export async function clearFirestore(): Promise<void> {
  const url = `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`clearFirestore failed: ${res.status}`);
}

export async function clearAuth(): Promise<void> {
  const url = `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`clearAuth failed: ${res.status}`);
}

/** Reads a document past the rules — used to assert on what the server wrote. */
export async function adminGet(
  path: string
): Promise<Record<string, unknown> | null> {
  const url = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
  const res = await fetch(url, { headers: ADMIN_HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`adminGet ${path} failed: ${res.status}`);
  return decode((await res.json()) as FirestoreDoc);
}

/** Lists a collection past the rules. */
export async function adminList(
  collectionPath: string
): Promise<Record<string, unknown>[]> {
  const url = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionPath}?pageSize=300`;
  const res = await fetch(url, { headers: ADMIN_HEADERS });
  if (!res.ok) throw new Error(`adminList ${collectionPath} failed: ${res.status}`);
  const body = (await res.json()) as { documents?: FirestoreDoc[] };
  return (body.documents ?? []).map(decode);
}

/**
 * Writes a document past the rules, e.g. the restaurant settings.
 *
 * `merge` matters: a Firestore REST PATCH with no updateMask REPLACES the
 * document with exactly the fields sent, silently dropping every other one.
 * Pass merge to touch a single field and leave the rest intact.
 */
export async function adminSet(
  path: string,
  data: Record<string, unknown>,
  { merge = false }: { merge?: boolean } = {}
): Promise<void> {
  const mask = merge
    ? "?" + Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&")
    : "";
  const url = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}${mask}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { ...ADMIN_HEADERS, "content-type": "application/json" },
    body: JSON.stringify({ fields: encodeFields(data) }),
  });
  if (!res.ok) {
    throw new Error(`adminSet ${path} failed: ${res.status} ${await res.text()}`);
  }
}

// --- Firestore REST value encoding ------------------------------------------

interface FirestoreDoc {
  name?: string;
  fields?: Record<string, FirestoreValue>;
}
type FirestoreValue = Record<string, unknown>;

function decode(doc: FirestoreDoc): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc.fields ?? {})) {
    out[key] = decodeValue(value);
  }
  return out;
}

function decodeValue(value: FirestoreValue): unknown {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) {
    const arr = value.arrayValue as { values?: FirestoreValue[] };
    return (arr.values ?? []).map(decodeValue);
  }
  if ("mapValue" in value) {
    const map = value.mapValue as { fields?: Record<string, FirestoreValue> };
    return decode({ fields: map.fields });
  }
  return undefined;
}

function encodeFields(
  data: Record<string, unknown>
): Record<string, FirestoreValue> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, encodeValue(v)])
  );
}

function encodeValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  return {
    mapValue: { fields: encodeFields(value as Record<string, unknown>) },
  };
}

/**
 * Polls until `check` returns a truthy value, or gives up.
 *
 * Background triggers (onDocumentUpdated, the auth onCreate) run out of band,
 * so there is no promise to await — the only honest option is to watch for the
 * effect and fail loudly if it never lands.
 */
export async function waitFor<T>(
  check: () => Promise<T | null | undefined | false>,
  { timeoutMs = 15_000, intervalMs = 250, label = "condition" } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value as T;
      last = value;
    } catch (cause) {
      last = cause;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${label}. Last value: ${String(last)}`
  );
}
