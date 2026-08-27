import { describe, expect, it } from "vitest";
import { nutritionCatalog, publishedMenuMacros } from "@/lib/database";
import { dailyTolerance } from "@/lib/dailyAdherence";
import {
  LANDING_WEEK,
  LANDING_WEEK_DISH_COUNT,
  LANDING_WEEK_SLOTS,
  LANDING_WEEK_TARGET,
} from "@/lib/landingWeek";

/**
 * The landing page shows this week as a real example of what the planner
 * produces, quoting dish names and macros. These tests are what stop that claim
 * from rotting: if the menu changes underneath it, the page has to be corrected
 * rather than quietly showing numbers Negrita no longer serves.
 */
const byName = new Map(nutritionCatalog.menuRecipes.map((r) => [r.name, r]));

describe("landing week", () => {
  it("covers all seven days", () => {
    expect(LANDING_WEEK).toHaveLength(7);
    expect(LANDING_WEEK.map((d) => d.day)).toEqual([
      "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
    ]);
  });

  it("only uses dishes that are really on the menu", () => {
    for (const day of LANDING_WEEK) {
      for (const meal of day.meals) {
        expect(byName.get(meal.dish), `${meal.dish} is not on the menu`).toBeDefined();
      }
    }
  });

  it("quotes each dish's published macros exactly", () => {
    for (const day of LANDING_WEEK) {
      for (const meal of day.meals) {
        const macros = publishedMenuMacros(byName.get(meal.dish)!);
        expect(macros, `${meal.dish} has no published macros`).not.toBeNull();
        expect(meal.energy_kcal, `${meal.dish} calories`).toBe(macros!.energy_kcal);
        expect(meal.protein_g, `${meal.dish} protein`).toBe(macros!.protein_g);
      }
    }
  });

  it("shows day totals that actually add up", () => {
    for (const day of LANDING_WEEK) {
      const kcal = day.meals.reduce((sum, m) => sum + m.energy_kcal, 0);
      const protein = day.meals.reduce((sum, m) => sum + m.protein_g, 0);
      expect(day.energy_kcal, `${day.day} calories`).toBe(kcal);
      expect(day.protein_g, `${day.day} protein`).toBe(protein);
    }
  });

  // The page says these days land on the target, so they have to — judged by
  // the planner's own tolerances rather than a number retyped here.
  it("lands every day on the stated calorie and protein target", () => {
    const kcalTolerance = dailyTolerance("energy_kcal", LANDING_WEEK_TARGET.energy_kcal);
    const proteinTolerance = dailyTolerance("protein_g", LANDING_WEEK_TARGET.protein_g);
    for (const day of LANDING_WEEK) {
      expect(
        Math.abs(day.energy_kcal - LANDING_WEEK_TARGET.energy_kcal),
        `${day.day} is outside the calorie tolerance`
      ).toBeLessThanOrEqual(kcalTolerance);
      expect(
        Math.abs(day.protein_g - LANDING_WEEK_TARGET.protein_g),
        `${day.day} is outside the protein tolerance`
      ).toBeLessThanOrEqual(proteinTolerance);
    }
  });

  it("reads as a varied week rather than the same day seven times", () => {
    const uses = new Map<string, number>();
    for (const day of LANDING_WEEK) {
      for (const meal of day.meals) {
        uses.set(meal.dish, (uses.get(meal.dish) ?? 0) + 1);
      }
    }
    for (const [dish, count] of uses) {
      expect(count, `${dish} appears too often`).toBeLessThanOrEqual(2);
    }
    expect(LANDING_WEEK_DISH_COUNT).toBeGreaterThanOrEqual(15);
  });

  it("uses known slots, in order, without repeating one within a day", () => {
    for (const day of LANDING_WEEK) {
      const slots = day.meals.map((m) => m.slot);
      expect(new Set(slots).size, `${day.day} repeats a slot`).toBe(slots.length);
      const order = slots.map((s) => LANDING_WEEK_SLOTS.indexOf(s));
      expect(order, `${day.day} is out of slot order`).toEqual([...order].sort((a, b) => a - b));
      expect(Math.min(...order), `${day.day} has an unknown slot`).toBeGreaterThanOrEqual(0);
    }
  });
});
