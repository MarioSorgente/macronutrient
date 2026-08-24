import { type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, limit, orderBy, query, setDoc, type Firestore }
  from "firebase/firestore";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { claims, testEnvironment } from "./helpers";
import type { Assignment, Plan } from "@/lib/storage/types";

/**
 * A generated week, written to and read back from the real Firestore emulator.
 *
 * The mocked repository tests assert the query shape; only this one can catch
 * what actually rejects a write — an `undefined` field value, a nested array,
 * the document size limit — or prove that the ordered read really does skip a
 * document with no `updatedAt`. That skip is what made an empty read look
 * authoritative, and an empty read used to be answered by overwriting the plan.
 */

const UID = "planner-user";
let env: RulesTestEnvironment;

beforeAll(async () => { env = await testEnvironment(); });
afterEach(async () => { await env.clearFirestore(); });
afterAll(async () => { await env?.cleanup(); });

function generatedWeek(): Plan {
  const assignments: Assignment[] = [];
  for (let day = 0; day < 7; day += 1) {
    for (const slot of ["Breakfast", "Lunch", "Dinner"]) {
      assignments.push({
        id: `${day}-${slot}`, week: 1, day, slot, servings: 1,
        items: [
          { ingredientId: "chicken_breast_raw", name: "Chicken", grams: 150,
            unitId: "g", quantity: 150 },
          { ingredientId: "rice_jasmine_cooked_proxy", name: "Jasmine rice",
            grams: 200, unitId: "g", quantity: 200 },
        ],
        price: { totalIdr: 55_000, complete: true },
        snapshot: { name: `${slot} day ${day}`,
          totals: { energy_kcal: 620, protein_g: 52, carbs_g: 61, fat_g: 19, fiber_g: 3 } },
      });
    }
  }
  return {
    id: "primary", createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z", ownerUid: UID, title: "My week",
    targets: { energy_kcal: 2000, protein_g: 125, carbs_g: 225, fat_g: 66.7 },
    targetMode: "preset",
    targetPreset: "balanced",
    preferences: { macroStyle: "balanced", proteinLean: ["fish"], avoidIngredientIds: [] },
    mealSlots: ["Breakfast", "Lunch", "Dinner"], programStartDate: "2026-03-30",
    weekCount: 4, assignments, status: "draft", submittedWeeks: [],
  };
}

/** The planner's own read: newest by `updatedAt`, one document. */
async function latest(db: Firestore, path: string): Promise<Plan | null> {
  const snap = await getDocs(
    query(collection(db, path), orderBy("updatedAt", "desc"), limit(1))
  );
  return snap.docs[0] ? (snap.docs[0].data() as Plan) : null;
}

describe("a generated week through the owner's real collection", () => {
  it("survives the round trip whole, assignments and inline items included", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      const path = `users/${UID}/plans`;
      const week = generatedWeek();

      await setDoc(doc(db, path, week.id), week);
      const read = await latest(db, path);

      expect(read).toEqual(week);
      expect(read?.assignments).toHaveLength(21);
      // Nested arrays are the thing Firestore refuses outright; a plan carries
      // assignments[].items[], which is array inside map inside array.
      expect(read?.assignments[0].items).toHaveLength(2);
      expect(read?.targets?.energy_kcal).toBe(2000);
      expect(read?.preferences?.proteinLean).toEqual(["fish"]);
    });
  });

  it("hides a document with no updatedAt from the ordered read", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      const path = `users/${UID}/plans`;
      const undated: Record<string, unknown> = { ...generatedWeek() };
      delete undated.updatedAt;

      await setDoc(doc(db, path, "primary"), undated);

      // The plan is there, and the planner's read cannot see it. Answering that
      // by writing a fresh empty plan to the same id is what destroyed it.
      expect(await latest(db, path)).toBeNull();
    });
  });

  it("keeps one owner's plan out of another's collection", async () => {
    const owner = env.authenticatedContext(UID, claims.client);
    const other = env.authenticatedContext("someone-else", claims.client);
    const week = generatedWeek();

    await setDoc(
      doc(owner.firestore() as unknown as Firestore, `users/${UID}/plans`, week.id),
      week
    );

    expect(await latest(
      other.firestore() as unknown as Firestore, `users/someone-else/plans`
    )).toBeNull();
    expect((await latest(
      owner.firestore() as unknown as Firestore, `users/${UID}/plans`
    ))?.assignments).toHaveLength(21);
  });
});
