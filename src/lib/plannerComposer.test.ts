import { describe, expect, it } from "vitest";
import { getIngredient } from "@/lib/database";
import { composeCandidatesForResidual } from "@/lib/plannerComposer";
import { DEFAULT_PREFERENCES } from "@/lib/storage/types";
import type { PlannerCandidate } from "@/types/nutrition";
import type { MacroTargets } from "@/lib/storage/types";

const compose = (slot: string, residual: MacroTargets, slotsRemaining = 1) =>
  composeCandidatesForResidual({
    slot, residual, slotsRemaining, preferences: DEFAULT_PREFERENCES,
    budgetRemainingIdr: null,
  });

const sectionsOf = (candidate: PlannerCandidate) =>
  candidate.breakdown.map((item) => getIngredient(item.ingredientId)?.diy_section);

describe("residual-driven DIY composition", () => {
  it("sizes the last meal of the day to the macros that actually remain", () => {
    // The number the brief uses: a large lunch has already been chosen and the
    // day has 780 kcal left, not a third of 2000.
    const residual = { energy_kcal: 780, protein_g: 52, carbs_g: 61, fat_g: 24 };
    const forResidual = compose("Dinner", residual);
    const forFullDay = compose("Dinner", { energy_kcal: 2000, protein_g: 175,
      carbs_g: 175, fat_g: 66.7 });

    expect(forResidual.length).toBeGreaterThan(10);
    const median = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const near = median(forResidual.map((c) => c.optimizerMacros.energy_kcal));
    const far = median(forFullDay.map((c) => c.optimizerMacros.energy_kcal));

    expect(near).toBeLessThan(far);
    expect(Math.abs(near - residual.energy_kcal)).toBeLessThan(200);
    // At least one candidate closes the residual almost exactly, which is the
    // whole point of composing after the earlier meals are known.
    const best = Math.min(...forResidual.map((c) =>
      Math.abs(c.optimizerMacros.energy_kcal - residual.energy_kcal) +
      Math.abs(c.optimizerMacros.protein_g - residual.protein_g) * 4));
    expect(best).toBeLessThan(60);
  });

  it("keeps the retained set diverse rather than one anchor's portion ladder", () => {
    const candidates = compose("Dinner", { energy_kcal: 800, protein_g: 55,
      carbs_g: 70, fat_g: 25 });
    const families = new Set(candidates.map((c) => c.proteinFamily));
    const anchors = new Set(candidates.flatMap((c) => c.breakdown
      .filter((item) => getIngredient(item.ingredientId)?.diy_section === "protein")
      .map((item) => item.ingredientId)));

    expect(families.size).toBeGreaterThanOrEqual(3);
    expect(anchors.size).toBeGreaterThanOrEqual(4);
    expect(new Set(candidates.map((c) => c.mealArchetype)).size).toBeGreaterThanOrEqual(3);
  });

  it("never proposes a garnish as the protein a meal is built on", () => {
    const candidates = compose("Lunch", { energy_kcal: 700, protein_g: 45,
      carbs_g: 60, fat_g: 25 });
    const garnishes = candidates.filter((c) => c.breakdown.some((item) =>
      item.ingredientId === "tobiko" || item.ingredientId === "anchovy_spanish"));
    expect(garnishes).toEqual([]);
  });
});

describe("optional template roles", () => {
  it("offers a salad or plate without a carbohydrate when that fits better", () => {
    const candidates = compose("Lunch", { energy_kcal: 520, protein_g: 55,
      carbs_g: 12, fat_g: 24 });
    const carbless = candidates.filter((c) => !sectionsOf(c).includes("carbs"));

    expect(carbless.length).toBeGreaterThan(0);
    expect(carbless.every((c) => c.optimizerMacros.carbs_g < 30)).toBe(true);
  });

  it("offers a pre-workout meal without a protein", () => {
    const candidates = compose("Pre-workout", { energy_kcal: 320, protein_g: 5,
      carbs_g: 65, fat_g: 3 });
    const proteinless = candidates.filter((c) => !sectionsOf(c).includes("protein"));

    expect(candidates.length).toBeGreaterThan(0);
    expect(proteinless.length).toBeGreaterThan(0);
  });

  it("offers a protein breakfast without a carbohydrate", () => {
    const candidates = compose("Breakfast", { energy_kcal: 340, protein_g: 34,
      carbs_g: 4, fat_g: 20 });
    expect(candidates.filter((c) => !sectionsOf(c).includes("carbs")).length)
      .toBeGreaterThan(0);
  });

  it("still enforces the roles an archetype requires", () => {
    const candidates = compose("Lunch", { energy_kcal: 800, protein_g: 55,
      carbs_g: 70, fat_g: 25 });
    for (const candidate of candidates.filter((c) => c.mealArchetype === "rice-bowl")) {
      const sections = sectionsOf(candidate);
      expect(sections, candidate.displayName).toContain("protein");
      expect(sections, candidate.displayName).toContain("carbs");
      expect(sections, candidate.displayName).toContain("veg");
    }
  });
});

describe("hard constraints in composition", () => {
  it("never includes an avoided ingredient", () => {
    const candidates = composeCandidatesForResidual({
      slot: "Dinner",
      residual: { energy_kcal: 800, protein_g: 55, carbs_g: 70, fat_g: 25 },
      slotsRemaining: 1,
      preferences: { ...DEFAULT_PREFERENCES,
        avoidIngredientIds: ["chicken_breast_raw", "rice_jasmine_cooked_proxy"] },
      budgetRemainingIdr: null,
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => c.breakdown.some((item) =>
      item.ingredientId === "chicken_breast_raw" ||
      item.ingredientId === "rice_jasmine_cooked_proxy"))).toBe(false);
  });

  it("keeps every composed meal inside a remaining budget", () => {
    const candidates = composeCandidatesForResidual({
      slot: "Dinner",
      residual: { energy_kcal: 800, protein_g: 55, carbs_g: 70, fat_g: 25 },
      slotsRemaining: 1, preferences: DEFAULT_PREFERENCES,
      budgetRemainingIdr: 150_000,
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.price.totalIdr <= 150_000)).toBe(true);
  });

  it("keeps dinner-only cuts out of breakfast", () => {
    const candidates = compose("Breakfast", { energy_kcal: 700, protein_g: 45,
      carbs_g: 60, fat_g: 25 });
    const dinnerOnly = ["chicken_peri_peri_negrita", "chicken_teriyaki_negrita",
      "chicken_breast_raw", "beef_tenderloin_raw", "salmon_atlantic_raw"];
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => c.breakdown.some((item) =>
      dinnerOnly.includes(item.ingredientId)))).toBe(false);
  });
});
