import { describe, expect, it } from "vitest";
import { diagnoseDailyAdherence } from "@/lib/dailyAdherence";
import {
  __selectDayPoolForTests,
  type TestingCompleteDay,
} from "@/lib/mealPlanner";
import { COMPLETE_DAY_TARGET, plannerFixture } from "@/lib/mealPlanner.fixtures";

const SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];
const EXACT_MACROS = { ...COMPLETE_DAY_TARGET, fiber_g: 0 };

type TestCandidate = TestingCompleteDay["picks"][number];

function candidate(name: string, slot: string, identity: string): TestCandidate {
  const fixture = plannerFixture(name, slot as "Breakfast" | "Lunch" | "Dinner" | "Snack",
    { energy_kcal: 500, protein_g: 37.5, carbs_g: 50, fat_g: 17.5 });
  return {
    ...fixture,
    name,
    items: fixture.breakdown.map((item) => ({ ...item, unitId: "g", quantity: item.grams })),
    macros: fixture.optimizerMacros,
    priceIdr: fixture.price.totalIdr,
    slotPenalty: 0,
    leaned: false,
    kind: "ready",
    dishShape: identity,
    familySignature: identity,
  };
}

function completeDay(focalSlot: string, choice: string, index: number,
  exact = true): TestingCompleteDay {
  const picks = SLOTS.map((slot) => candidate(
    slot === focalSlot ? `${focalSlot} ${choice}` : `${slot} supporting choice ${index}`,
    slot,
    slot === focalSlot ? `${focalSlot}-${choice}` : `${slot}-support-${index}`,
  ));
  const macros = exact
    ? EXACT_MACROS
    : { ...EXACT_MACROS, protein_g: COMPLETE_DAY_TARGET.protein_g + 20 };
  return {
    picks,
    macros,
    priceIdr: 100_000,
    diagnostics: diagnoseDailyAdherence(macros, COMPLETE_DAY_TARGET),
  };
}

function arrangement(focalSlot: string): TestingCompleteDay[] {
  return [
    ...Array.from({ length: 20 }, (_, index) => completeDay(focalSlot, "A", index)),
    ...Array.from({ length: 4 }, (_, offset) => completeDay(focalSlot, "B", 20 + offset)),
    ...Array.from({ length: 4 }, (_, offset) => completeDay(focalSlot, "C", 24 + offset)),
  ];
}

describe("day-pool minority slot retention", () => {
  for (const focalSlot of ["Lunch", "Dinner", "Snack"]) {
    it(`retains minority ${focalSlot} choices within the best adherence class`, () => {
      const worse = completeDay(focalSlot, "worse", 28, false);
      const pool = __selectDayPoolForTests([...arrangement(focalSlot), worse], SLOTS);
      const slotIndex = SLOTS.indexOf(focalSlot);
      const choices = pool.map((day) => day.picks[slotIndex].name);

      expect(choices).toContain(`${focalSlot} B`);
      expect(choices).toContain(`${focalSlot} C`);
      expect(pool.every((day) => day.diagnostics.classification === "Exact")).toBe(true);
      expect(choices).not.toContain(`${focalSlot} worse`);
    });
  }
});
