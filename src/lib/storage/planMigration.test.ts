import { describe, expect, it } from "vitest";
import { migratePlan } from "@/lib/storage";

const legacy = (targets: unknown, macroStyle = "low_carb") => ({
  id: "legacy",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  targets,
  preferences: { macroStyle, proteinLean: [], avoidIngredientIds: [] },
});

describe("plan target migration", () => {
  it("migrates complete legacy targets as custom so no preset is falsely active", () => {
    const plan = migratePlan(legacy({
      energy_kcal: 2000, protein_g: 160, carbs_g: 180, fat_g: 70,
    }));
    expect(plan).toMatchObject({ targetMode: "custom" });
    expect(plan?.targetPreset).toBeUndefined();
  });

  it("keeps a legacy preference as the preset when no targets were stored", () => {
    expect(migratePlan(legacy(null))).toMatchObject({
      targetMode: "preset", targetPreset: "low_carb",
    });
  });
});
