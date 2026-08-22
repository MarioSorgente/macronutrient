import { afterEach, describe, expect, it } from "vitest";
import rawDatabase from "@data/negrita-database.json";
import {
  categories,
  categoryLabel,
  databaseMeta,
  diyMenu,
  getAllIngredients,
  getIngredient,
  getRecipe,
  getUnit,
  hasHouseOverride,
  ingredients,
  isEstimated,
  isMenuStated,
  isPriced,
  menuRecipes,
  rankIngredients,
  searchIngredients,
  setHouseOverrides,
} from "@/lib/database";
import { GRAM_UNIT_ID, type Macros } from "@/types/nutrition";

/**
 * The bundled database and its enrichment overlays.
 *
 * The contract the README makes: `data/negrita-database.json` is Negrita's
 * provenance record and is never mutated; portions, prices and the added
 * ingredients are merged at load so every addition stays auditable.
 */

const CHICKEN = "chicken_breast_raw";

// House overrides are module-level state; leaving one set would leak into
// every later test in the file.
afterEach(() => setHouseOverrides(new Map()));

describe("the merged catalogue", () => {
  it("keeps every source ingredient and adds the enrichment ones", () => {
    const source = (rawDatabase as { ingredients: unknown[] }).ingredients.length;
    expect(source).toBe(91);
    expect(ingredients.length).toBeGreaterThan(source);
  });

  it("never mutates the source record", () => {
    const source = (rawDatabase as {
      ingredients: { ingredient_id: string; units?: unknown; price_idr?: unknown }[];
    }).ingredients;
    const chicken = source.find((i) => i.ingredient_id === CHICKEN)!;
    // Decoration adds units/prices to the *copy*, never to the provenance file.
    expect(chicken.units).toBeUndefined();
    expect(chicken.price_idr).toBeUndefined();
  });

  it("offers grams first for every ingredient, so there is always a fallback", () => {
    expect(ingredients.every((i) => i.units[0]?.id === GRAM_UNIT_ID)).toBe(true);
  });

  it("gives every ingredient a default unit that it actually has", () => {
    const bad = ingredients.filter(
      (i) => !i.units.some((u) => u.id === i.defaultUnitId)
    );
    expect(bad.map((i) => i.ingredient_id)).toEqual([]);
  });

  it("has unique ingredient ids", () => {
    const ids = ingredients.map((i) => i.ingredient_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the first DIY line when one ingredient backs two", () => {
    // wagyu_ground_raw_proxy appears twice (ground beef / patty); they share a
    // portion and price, so the first wins rather than the last silently.
    const dupes = diyMenu.filter((i) => i.ingredient_id === "wagyu_ground_raw_proxy");
    expect(dupes.length).toBeGreaterThan(1);
    const merged = getIngredient("wagyu_ground_raw_proxy");
    expect(merged?.diy_name).toBe(dupes[0].name);
    expect(merged?.price_idr).toBe(dupes[0].price_idr);
  });

  it("exposes database metadata", () => {
    expect(databaseMeta.name).toBeTruthy();
    expect(databaseMeta.version).toBeTruthy();
  });
});

describe("menu recipes", () => {
  it("carries all 25 menu dishes", () => {
    expect(menuRecipes).toHaveLength(25);
  });

  it("fills in the gram quantities the printed menu omits", () => {
    // Without the fitted quantities, 24 of 25 dishes compute from only their
    // stated components and understate their macros badly.
    const complete = menuRecipes.filter((r) => r.quantity_complete);
    expect(complete.length).toBeGreaterThan(20);
  });

  it("finds a recipe by id and returns undefined for a bad one", () => {
    expect(getRecipe(menuRecipes[0].recipe_id)?.recipe_id)
      .toBe(menuRecipes[0].recipe_id);
    expect(getRecipe("no_such_recipe")).toBeUndefined();
  });
});

describe("searchIngredients", () => {
  it("matches every token anywhere, so partial multi-word queries work", () => {
    const found = searchIngredients("chick br", null);
    expect(found.some((i) => i.ingredient_id === CHICKEN)).toBe(true);
  });

  it("searches menu aliases as well as names", () => {
    // "organic free-range chicken breast" is a menu alias, not the real name.
    const found = searchIngredients("free-range", null);
    expect(found.some((i) => i.ingredient_id === CHICKEN)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(searchIngredients("CHICKEN BREAST", null).length)
      .toBe(searchIngredients("chicken breast", null).length);
  });

  it("returns everything for an empty query", () => {
    expect(searchIngredients("", null)).toHaveLength(ingredients.length);
    expect(searchIngredients("   ", null)).toHaveLength(ingredients.length);
  });

  it("narrows by category", () => {
    const meat = searchIngredients("", "meat");
    expect(meat.length).toBeGreaterThan(0);
    expect(meat.every((i) => i.category === "meat")).toBe(true);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchIngredients("zzzznotathing", null)).toEqual([]);
  });
});

describe("rankIngredients", () => {
  it("puts a name that starts with the query above one that merely contains it", () => {
    const results = searchIngredients("chicken", null);
    const ranked = rankIngredients(results, "chicken");
    expect(ranked[0].name.toLowerCase().startsWith("chicken")).toBe(true);
  });

  it("leaves the order alone for an empty query", () => {
    const results = searchIngredients("", null);
    expect(rankIngredients(results, "")).toEqual(results);
  });

  it("does not mutate the array it was given", () => {
    const results = searchIngredients("chicken", null);
    const before = results.map((i) => i.ingredient_id);
    rankIngredients(results, "chicken");
    expect(results.map((i) => i.ingredient_id)).toEqual(before);
  });
});

describe("house overrides", () => {
  const OVERRIDE: Macros = {
    energy_kcal: 999, protein_g: 11, carbs_g: 22, fat_g: 33, fiber_g: 4,
  };

  it("replaces the shipped estimate everywhere once a recipe is defined", () => {
    expect(getIngredient(CHICKEN)?.macros_per_100g.energy_kcal).toBe(106);
    setHouseOverrides(new Map([[CHICKEN, OVERRIDE]]));
    expect(getIngredient(CHICKEN)?.macros_per_100g).toEqual(OVERRIDE);
    expect(getIngredient(CHICKEN)?.source_status).toBe("negrita_recipe");
    expect(hasHouseOverride(CHICKEN)).toBe(true);
  });

  it("reverts cleanly when the overrides are cleared", () => {
    setHouseOverrides(new Map([[CHICKEN, OVERRIDE]]));
    setHouseOverrides(new Map());
    expect(getIngredient(CHICKEN)?.macros_per_100g.energy_kcal).toBe(106);
    expect(hasHouseOverride(CHICKEN)).toBe(false);
  });

  it("returns the identical array when nothing is overridden", () => {
    expect(getAllIngredients()).toBe(ingredients);
  });

  it("applies overrides through getAllIngredients and search", () => {
    setHouseOverrides(new Map([[CHICKEN, OVERRIDE]]));
    const all = getAllIngredients();
    expect(all.find((i) => i.ingredient_id === CHICKEN)?.macros_per_100g)
      .toEqual(OVERRIDE);
    expect(
      searchIngredients("chicken breast", null)
        .find((i) => i.ingredient_id === CHICKEN)?.macros_per_100g
    ).toEqual(OVERRIDE);
  });

  it("leaves an unknown id alone", () => {
    setHouseOverrides(new Map([["not_real", OVERRIDE]]));
    expect(getIngredient("not_real")).toBeUndefined();
  });
});

describe("provenance predicates", () => {
  it("classifies estimated, menu-stated and priced ingredients", () => {
    const estimated = ingredients.filter(isEstimated);
    const menuStated = ingredients.filter(isMenuStated);
    const priced = ingredients.filter(isPriced);
    expect(estimated.length).toBeGreaterThan(0);
    expect(menuStated.length).toBeGreaterThan(0);
    expect(priced.length).toBe(new Set(diyMenu.map((d) => d.ingredient_id)).size);
  });

  it("gives every priced ingredient a positive portion size to divide by", () => {
    // portionsFor divides by this; a zero would make everything free.
    expect(
      ingredients.filter(isPriced).filter((i) => !i.diy_portion_g || i.diy_portion_g <= 0)
    ).toEqual([]);
  });
});

describe("categories and units", () => {
  it("lists distinct categories alphabetically", () => {
    expect(categories).toEqual([...new Set(categories)]);
    expect(categories).toEqual([...categories].sort((a, b) => a.localeCompare(b)));
  });

  it("labels a slug for humans", () => {
    expect(categoryLabel("house_sauce")).toBe("House sauce");
    expect(categoryLabel("meat")).toBe("Meat");
  });

  it("getUnit finds a real unit and misses a fake one", () => {
    const chicken = getIngredient(CHICKEN)!;
    expect(getUnit(chicken, GRAM_UNIT_ID)?.id).toBe(GRAM_UNIT_ID);
    expect(getUnit(chicken, "not_a_unit")).toBeUndefined();
  });
});
