import { describe, expect, it } from "vitest";
import { resolveTarget, scaleTargetEnergy, validateMacroTarget } from "@/lib/targetResolution";

const macroEnergy = (target: ReturnType<typeof resolveTarget>["target"]) =>
  target.protein_g * 4 + target.carbs_g * 4 + target.fat_g * 9;

describe("resolveTarget", () => {
  it("uses the stored mode instead of inferring precedence from four values", () => {
    const complete = { energy_kcal: 2000, protein_g: 1, carbs_g: 2, fat_g: 3 };
    expect(resolveTarget({ targets: complete, mode: "preset", preset: "low_carb" }))
      .toMatchObject({ source: "derived", selectedStyle: "Low carb / high fat" });
    expect(resolveTarget({ targets: complete, mode: "custom", preset: "low_carb" }))
      .toMatchObject({ target: complete, source: "explicit", selectedStyle: "Explicit" });
  });

  it("preserves a complete explicit target exactly, even if its macro energy differs", () => {
    const explicit = { energy_kcal: 2101, protein_g: 151, carbs_g: 199, fat_g: 64 };
    expect(resolveTarget({ targets: explicit, style: "low_carb" })).toMatchObject({
      target: explicit, source: "explicit", selectedStyle: "Explicit",
    });
  });

  it.each([
    ["High protein", [0.35, 0.35, 0.3], "35% protein, 35% carbohydrate, and 30% fat"],
    ["Balanced", [0.25, 0.45, 0.3], "25% protein, 45% carbohydrate, and 30% fat"],
    ["Low carb / high fat", [0.3, 0.15, 0.55], "30% protein, 15% carbohydrate, and 55% fat"],
    ["High carb", [0.2, 0.55, 0.25], "20% protein, 55% carbohydrate, and 25% fat"],
  ] as const)("derives and reconciles %s", (style, split, percentages) => {
    const result = resolveTarget({ targets: { energy_kcal: 2123 }, style });
    expect(result.source).toBe("derived");
    expect(result.target.protein_g).toBe(2123 * split[0] / 4);
    expect(macroEnergy(result.target)).toBeCloseTo(2123, 10);
    expect(result.explanation).toContain(percentages);
    expect(result.explanation).not.toContain("00000000000001");
  });

  it("maps Auto and an entirely empty input to the documented Balanced default", () => {
    expect(resolveTarget({ style: "Auto" })).toEqual(resolveTarget({}));
    expect(resolveTarget({}).selectedStyle).toBe("Balanced");
    expect(macroEnergy(resolveTarget({}).target)).toBeCloseTo(2000, 10);
  });
});

describe("target integrity", () => {
  it("rescales an explicit split when calories alone change", () => {
    const result = scaleTargetEnergy(
      { energy_kcal: 2000, protein_g: 175, carbs_g: 175, fat_g: 66.7 }, 4000);
    expect(result).toMatchObject({ energy_kcal: 4000 });
    expect(result.protein_g).toBeCloseTo(350, 0);
    expect(result.carbs_g).toBeCloseTo(350, 0);
    expect(result.fat_g).toBeCloseTo(133.4, 0);
    expect(validateMacroTarget(result).valid).toBe(true);
  });

  it("rejects a target of nothing", () => {
    // Zero grams of everything is arithmetically consistent with zero calories,
    // so the coherence check alone called an emptied form valid — Save enabled,
    // and a planner asked to assemble a day that adds up to nothing.
    expect(validateMacroTarget({
      energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
    }).valid).toBe(false);
    expect(validateMacroTarget({
      energy_kcal: 1, protein_g: 0, carbs_g: 0, fat_g: 0,
    }).valid).toBe(true);
  });

  it("rejects the reported contradictory 4000 kcal target", () => {
    const validation = validateMacroTarget({
      energy_kcal: 4000, protein_g: 175, carbs_g: 175, fat_g: 66.7,
    });
    expect(validation.valid).toBe(false);
    expect(validation.macroEnergyKcal).toBeCloseTo(2000.3, 5);
  });
});
