import { describe, expect, it } from "vitest";
import {
  DAILY_TOLERANCES,
  diagnoseDailyAdherence,
} from "@/lib/dailyAdherence";

const targets = { energy_kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 70 };

describe("daily adherence policy", () => {
  it("uses one absolute daily tolerance per macro", () => {
    expect(DAILY_TOLERANCES).toEqual({
      energy_kcal: { kind: "absolute", amount: 100 },
      protein_g: { kind: "absolute", amount: 6 },
      carbs_g: { kind: "absolute", amount: 6 },
      fat_g: { kind: "absolute", amount: 6 },
    });
    const result = diagnoseDailyAdherence(
      { ...targets, energy_kcal: 2040, protein_g: 146, carbs_g: 205, fat_g: 73, fiber_g: 0 },
      targets
    );
    expect(result.classification).toBe("Within tolerance");
    expect(result.compliant).toBe(true);
  });

  it("holds the window at 100 kcal and 6 g, and closes it after", () => {
    const day = (over: Partial<typeof targets>) => diagnoseDailyAdherence(
      { ...targets, ...over, fiber_g: 0 }, targets).classification;

    // The edge is inclusive on both sides, and one unit past it is not.
    expect(day({ energy_kcal: 2100 })).toBe("Within tolerance");
    expect(day({ energy_kcal: 1900 })).toBe("Within tolerance");
    expect(day({ energy_kcal: 2101 })).toBe("Best effort");
    expect(day({ protein_g: 156, carbs_g: 206, fat_g: 76 })).toBe("Within tolerance");
    expect(day({ protein_g: 157 })).toBe("Best effort");
    expect(day({ fat_g: 77 })).toBe("Best effort");
    // Calories are absolute now, so a big target gets no more room than a small
    // one: 3 % of 4,000 would have been 120.
    expect(diagnoseDailyAdherence(
      { energy_kcal: 4110, protein_g: 300, carbs_g: 400, fat_g: 133, fiber_g: 0 },
      { energy_kcal: 4000, protein_g: 300, carbs_g: 400, fat_g: 133 }
    ).classification).toBe("Best effort");
  });

  it("identifies best-effort failure dimensions and reason codes", () => {
    // Past the ±6 g window on both, so the day is genuinely out on two macros.
    const result = diagnoseDailyAdherence(
      { ...targets, protein_g: 143, fat_g: 77, fiber_g: 0 },
      targets,
      { kitchenPortionsConstrained: true }
    );
    expect(result.classification).toBe("Best effort");
    expect(result.failureDimensions).toEqual(["protein_g", "fat_g"]);
    expect(result.reasonCodes).toEqual([
      "protein_below_tolerance", "fat_above_tolerance",
      "kitchen_portion_increments_prevent_compliance",
    ]);
    expect(result.macros.protein_g).toMatchObject({
      target: 150, actual: 143, deviation: -7, signedDeviation: -7,
      tolerance: 6, allowedTolerance: 6, status: "fail", compliant: false,
    });
    expect(result.reasons).toEqual([
      { code: "protein_below_tolerance", message: "Protein cannot reach its lower bound." },
      { code: "fat_above_tolerance", message: "Fat cannot stay below its upper bound." },
      { code: "kitchen_portion_increments_prevent_compliance",
        message: "Kitchen portion increments prevent a compliant combination." },
    ]);
  });

  it("calls deviations exact when every displayed value rounds to zero", () => {
    const result = diagnoseDailyAdherence(
      { energy_kcal: 2000.49, protein_g: 150.049, carbs_g: 199.951,
        fat_g: 70.049, fiber_g: 0 }, targets
    );
    expect(result.classification).toBe("Exact");
  });

  it("classifies incomplete days as impossible", () => {
    const result = diagnoseDailyAdherence(
      { ...targets, fiber_g: 0 }, targets,
      { complete: false, restrictionsApplied: true, unavailableSlots: ["Breakfast"] }
    );
    expect(result.classification).toBe("Impossible");
    expect(result.reasonCodes).toEqual([
      "insufficient_eligible_candidates", "no_eligible_breakfast_candidates",
      "restrictions_make_target_infeasible",
    ]);
    expect(result.reasons[1]).toEqual({
      code: "no_eligible_breakfast_candidates",
      message: "No eligible breakfast candidates are available.",
    });
  });
});
