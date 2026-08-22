import { describe, expect, it } from "vitest";
import {
  findUnit,
  fromGrams,
  hasPortionUnits,
  normalizeQuantity,
  stepFor,
  toGrams,
  unitsFor,
} from "@/lib/units";
import { getIngredient } from "@/lib/database";
import { GRAM_UNIT, GRAM_UNIT_ID, type PortionUnit } from "@/types/nutrition";

/**
 * Portion units are an input convenience only — grams stay authoritative for
 * every macro and price calculation. These pin that boundary.
 */

const EGGISH: PortionUnit = {
  id: "large",
  label: "large",
  gramWeight: 50,
  integerOnly: true,
};

const TBSP: PortionUnit = { id: "tbsp", label: "tbsp", gramWeight: 13.6 };

describe("toGrams", () => {
  it("multiplies quantity by the unit weight", () => {
    expect(toGrams(EGGISH, 2)).toBe(100);
    expect(toGrams(TBSP, 2)).toBeCloseTo(27.2, 6);
  });

  it.each([
    ["zero", 0],
    ["negative", -3],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("clamps a %s quantity to 0 rather than producing a bad weight", (_l, q) => {
    expect(toGrams(EGGISH, q)).toBe(0);
  });
});

describe("fromGrams", () => {
  it("converts grams back into whole countable units", () => {
    expect(fromGrams(EGGISH, 100)).toBe(2);
    expect(fromGrams(EGGISH, 120)).toBe(2); // rounds to nearest whole egg
    expect(fromGrams(EGGISH, 130)).toBe(3);
  });

  it("never shows zero of a countable unit", () => {
    // Half an egg rounds to 0, which would render as "0 large" — the floor at
    // 1 is deliberate.
    expect(fromGrams(EGGISH, 20)).toBe(1);
  });

  it("keeps two decimals for a measurable unit", () => {
    expect(fromGrams(TBSP, 20)).toBeCloseTo(1.47, 2);
  });

  it("returns 0 for a unit with no weight rather than dividing by zero", () => {
    expect(fromGrams({ id: "x", label: "x", gramWeight: 0 }, 100)).toBe(0);
  });
});

describe("normalizeQuantity", () => {
  it("rounds a countable unit to a whole number", () => {
    expect(normalizeQuantity(EGGISH, 2.4)).toBe(2);
    expect(normalizeQuantity(EGGISH, 2.6)).toBe(3);
  });

  it("leaves a measurable unit alone", () => {
    expect(normalizeQuantity(TBSP, 2.5)).toBe(2.5);
  });

  it.each([
    ["negative", -1],
    ["NaN", Number.NaN],
  ])("clamps a %s quantity to 0", (_l, q) => {
    expect(normalizeQuantity(TBSP, q)).toBe(0);
  });
});

describe("stepFor", () => {
  it("steps grams by 10, countables by 1, and measurables by a half", () => {
    expect(stepFor(GRAM_UNIT)).toBe(10);
    expect(stepFor(EGGISH)).toBe(1);
    expect(stepFor(TBSP)).toBe(0.5);
  });
});

describe("unitsFor / findUnit / hasPortionUnits", () => {
  it("falls back to grams for an unknown ingredient or unit id", () => {
    expect(unitsFor(undefined)).toEqual([GRAM_UNIT]);
    expect(findUnit(undefined, "nonsense")).toEqual(GRAM_UNIT);
    expect(hasPortionUnits(undefined)).toBe(false);
  });

  it("offers grams first for a real ingredient that has portion units", () => {
    // broccoli_boiled carries a curated "spear" unit in the enrichment overlay.
    const broccoli = getIngredient("broccoli_boiled");
    expect(broccoli).toBeDefined();
    expect(broccoli!.units[0].id).toBe(GRAM_UNIT_ID);
    expect(hasPortionUnits(broccoli)).toBe(true);
  });

  it("round-trips a real portion unit through grams and back", () => {
    const broccoli = getIngredient("broccoli_boiled")!;
    const spear = broccoli.units.find((u) => u.integerOnly);
    expect(spear).toBeDefined();
    expect(fromGrams(spear!, toGrams(spear!, 3))).toBe(3);
  });
});
