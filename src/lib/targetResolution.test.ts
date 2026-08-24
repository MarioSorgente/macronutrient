import { describe, expect, it } from "vitest";
import { resolveTarget, scaleTargetEnergy, validateMacroTarget } from "@/lib/targetResolution";

const macroEnergy = (target: ReturnType<typeof resolveTarget>["target"]) =>
  target.protein_g * 4 + target.carbs_g * 4 + target.fat_g * 9;

describe("resolveTarget", () => {
  it("preserves a complete explicit target exactly, even if its macro energy differs", () => {
    const explicit = { energy_kcal: 2101, protein_g: 151, carbs_g: 199, fat_g: 64 };
    expect(resolveTarget({ targets: explicit, style: "low_carb" })).toMatchObject({
      target: explicit, source: "explicit", selectedStyle: "Explicit",
    });
  });

  it.each([
    ["High protein", [0.35, 0.35, 0.3]], ["Balanced", [0.25, 0.45, 0.3]],
    ["Low carb", [0.3, 0.15, 0.55]], ["High carb", [0.2, 0.55, 0.25]],
  ] as const)("derives and reconciles %s", (style, split) => {
    const result = resolveTarget({ targets: { energy_kcal: 2123 }, style });
    expect(result.source).toBe("derived");
    expect(result.target.protein_g).toBe(2123 * split[0] / 4);
    expect(macroEnergy(result.target)).toBeCloseTo(2123, 10);
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

  it("rejects the reported contradictory 4000 kcal target", () => {
    const validation = validateMacroTarget({
      energy_kcal: 4000, protein_g: 175, carbs_g: 175, fat_g: 66.7,
    });
    expect(validation.valid).toBe(false);
    expect(validation.macroEnergyKcal).toBeCloseTo(2000.3, 5);
  });
});
