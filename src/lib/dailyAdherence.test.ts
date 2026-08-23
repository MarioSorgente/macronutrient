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
      targets
    );
    expect(result.classification).toBe("Best effort");
    expect(result.failureDimensions).toEqual(["protein_g", "fat_g"]);
    expect(result.reasonCodes).toEqual([
      "protein_below_tolerance", "fat_above_tolerance",
    ]);
  });

  it("classifies incomplete days as impossible", () => {
    const result = diagnoseDailyAdherence(
      { ...targets, fiber_g: 0 }, targets,
      { complete: false, restrictionsApplied: true }
    );
    expect(result.classification).toBe("Impossible");
    expect(result.reasonCodes).toEqual([
      "insufficient_eligible_candidates", "restrictions_make_target_infeasible",
    ]);
  });
});
