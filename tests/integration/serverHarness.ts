import { adminAuth, adminDb } from "@/lib/server/firebaseAdmin";

/**
 * Emulator plumbing for the server modules.
 *
 * These tests call the server logic directly rather than over HTTP: the route
 * handlers are ten-line wrappers whose only job is to verify a token and pass
 * the body along, so testing through them would mostly be testing Next. The
 * HTTP layer is covered end to end by the Playwright suite instead.
 *
 * vitest.config.ts sets FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST
 * for this project, so the Admin SDK here talks to the emulators and never to a
 * real project.
 */

export const PROJECT_ID = "demo-mamma";
export const RID = "negrita";

let seq = 0;

export function uniqueEmail(prefix = "person"): string {
  return `${prefix}-${(seq += 1)}-${Date.now()}@example.com`;
}

/** Creates an account, optionally already confirmed. */
export async function createUser(
  email: string,
  { verified = false } = {}
): Promise<string> {
  const user = await adminAuth().createUser({
    email,
    password: "password123",
    emailVerified: verified,
  });
  return user.uid;
}

export async function setVerified(uid: string, emailVerified = true) {
  await adminAuth().updateUser(uid, { emailVerified });
}

export async function claimsOf(uid: string): Promise<Record<string, unknown>> {
  return ((await adminAuth().getUser(uid)).customClaims ?? {}) as Record<string, unknown>;
}

export async function docAt(path: string): Promise<Record<string, unknown> | null> {
  const snap = await adminDb().doc(path).get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : null;
}

export async function listAt(path: string): Promise<Record<string, unknown>[]> {
  const snap = await adminDb().collection(path).get();
  return snap.docs.map((d) => d.data() as Record<string, unknown>);
}

/** Wipes both emulators between tests. */
export async function resetEmulators(): Promise<void> {
  await Promise.all([
    fetch(
      `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: "DELETE" }
    ),
    fetch(
      `http://127.0.0.1:9099/emulator/v1/projects/${PROJECT_ID}/accounts`,
      { method: "DELETE" }
    ),
  ]);
}

/** A Monday `weeks` weeks out, so a week's cutoff is still open. */
export function mondayAhead(weeks: number): string {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dow = (new Date(midnight).getUTCDay() + 6) % 7;
  return new Date(midnight - dow * 86_400_000 + weeks * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export async function seedRestaurant(over: Record<string, unknown> = {}) {
  await adminDb().doc(`restaurants/${RID}`).set({
    id: RID,
    name: "Negrita",
    timezone: "Asia/Makassar",
    cutoffDay: 6,
    cutoffTime: "18:00",
    acceptingOrders: true,
    markupPct: 0,
    createdAt: "",
    updatedAt: "",
    ...over,
  });
}

const CHICKEN = "chicken_breast_raw";

export function meal(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    week: 1,
    day: 0,
    slot: "Lunch",
    servings: 1,
    items: [
      { ingredientId: CHICKEN, name: "Chicken", grams: 150, unitId: "g", quantity: 150 },
    ],
    snapshot: {
      name: "Chicken plate",
      totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    },
    ...over,
  };
}

export async function seedPlan(
  uid: string,
  planId = "p1",
  over: Record<string, unknown> = {}
) {
  await adminDb().doc(`users/${uid}/plans/${planId}`).set({
    id: planId,
    ownerUid: uid,
    title: "My week",
    targets: null,
    mealSlots: ["Breakfast", "Lunch"],
    programStartDate: mondayAhead(3),
    weekCount: 2,
    assignments: [meal()],
    status: "draft",
    submittedWeeks: [],
    createdAt: "",
    updatedAt: "",
    ...over,
  });
}
