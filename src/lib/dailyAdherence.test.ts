import { describe, expect, it } from "vitest";
import {
  DAILY_TOLERANCES,
  diagnoseDailyAdherence,
} from "@/lib/dailyAdherence";

const targets = { energy_kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 70 };

describe("daily adherence policy", () => {
  it("uses the shared percent and absolute daily tolerances", () => {
    expect(DAILY_TOLERANCES.energy_kcal).toEqual({ kind: "percent", amount: 0.02 });
    const result = diagnoseDailyAdherence(
      { ...targets, energy_kcal: 2040, protein_g: 146, carbs_g: 205, fat_g: 73, fiber_g: 0 },
      targets
    );
    expect(result.classification).toBe("Within tolerance");
    expect(result.compliant).toBe(true);
  });

  it("identifies best-effort failure dimensions and reason codes", () => {
    const result = diagnoseDailyAdherence(
      { ...targets, protein_g: 145, fat_g: 74, fiber_g: 0 },
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
      target: 150, actual: 145, deviation: -5, signedDeviation: -5,
      tolerance: 4, allowedTolerance: 4, status: "fail", compliant: false,
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
