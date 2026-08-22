import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

/**
 * Shared emulator wiring for the rules suite.
 *
 * The project id carries the `demo-` prefix so the Firebase tooling treats it
 * as an emulator-only project and never reaches for real credentials.
 */
export const PROJECT_ID = "demo-mamma";
export const RID = "negrita";

const rulesPath = fileURLToPath(new URL("../../firestore.rules", import.meta.url));

export function testEnvironment(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(rulesPath, "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
}

/** Claims shaped the way the roles Cloud Function actually stamps them. */
export const claims = {
  client: { role: "client", rid: RID },
  restaurant: { role: "restaurant", rid: RID },
  admin: { role: "admin", rid: RID },
  /** A staff member of a different tenant — must not reach Negrita's data. */
  otherRestaurant: { role: "restaurant", rid: "someone-else" },
  /** Signed in, but the role trigger never ran. */
  noRole: {},
} as const;

/** Minimal documents that satisfy the shapes the rules inspect. */
export function orderDoc(over: Record<string, unknown> = {}) {
  return {
    id: "o1",
    restaurantId: RID,
    userId: "customer",
    planId: "p1",
    weekNumber: 1,
    weekStartDate: "2026-08-24",
    status: "submitted",
    customer: { name: "Mario", email: "m@example.com" },
    days: [],
    totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    priceIdr: 100_000,
    mealCount: 3,
    payment: { status: "unpaid", method: "cash", amountIdr: 100_000 },
    submittedAt: "2026-08-20T00:00:00.000Z",
    lockedAt: "2026-08-22T10:00:00.000Z",
    statusHistory: [],
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...over,
  };
}

export function prepTaskDoc(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    restaurantId: RID,
    orderId: "o1",
    userId: "customer",
    date: "2026-08-24",
    slot: "Lunch",
    readyBy: "12:00",
    mode: "pickup",
    customerName: "Mario",
    mealName: "Chicken plate",
    servings: 1,
    items: [],
    totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    status: "todo",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...over,
  };
}

export function userDoc(uid: string, over: Record<string, unknown> = {}) {
  return {
    id: uid,
    uid,
    email: `${uid}@example.com`,
    displayName: uid,
    role: "client",
    rid: RID,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    roleUpdatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}
