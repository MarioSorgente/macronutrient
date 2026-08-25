// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { menuRecipes, publishedMenuMacros } from "@/lib/database";
import { assignmentMacros, assignmentPrice, byId } from "@/lib/clients";
import { migratePlan } from "@/lib/storage/index";
import type { Assignment, Dish, Plan } from "@/lib/storage/types";
import type { MenuRecipe } from "@/types/nutrition";

/**
 * Putting a Negrita dish into a slot by hand.
 *
 * Until now the only route was the builder's template picker: load the dish,
 * save it as your own, assign that. What came back was a copy — 1,139 kcal and
 * Rp 15,000 of ingredients where the menu says 1,095 and Rp 89,000 — because a
 * saved dish is priced and counted from its parts, which is right for a saved
 * dish and wrong for this one. The menu belongs in the planner, and a dish put
 * in from there keeps its identity.
 */

vi.mock("@/lib/storage/repos", () => ({
  useRepos: () => ({ plans: {}, dishes: {}, houseRecipes: {}, uid: null, loading: false }),
}));

import AssignDishDialog from "@/components/AssignDishDialog";

const PANCAKE = "special_protein_pancake";
const recipeOf = (id: string) => menuRecipes.find((entry) => entry.recipe_id === id)!;
const NO_DISHES = byId([]);

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Renders the dialog and returns whatever the menu tab hands back. */
function openDialog() {
  const chosen: { recipe?: MenuRecipe; servings?: number } = {};
  render(
    <AssignDishDialog
      dishes={[]}
      dishesLoading={false}
      dishesError={null}
      slot="Breakfast"
      dayLabel="Week 1 · Monday"
      onAssign={() => {}}
      onAssignMenuDish={(recipe, servings) => {
        chosen.recipe = recipe;
        chosen.servings = servings;
      }}
      onAssignCustom={() => {}}
      onClose={() => {}}
    />
  );
  return chosen;
}

describe("the add-to-slot dialog", () => {
  it("opens on the Negrita menu and lists what the restaurant sells", () => {
    openDialog();

    // Not "no saved dishes yet" — the menu is the first thing offered.
    expect(screen.getByPlaceholderText("Search Negrita menu…")).toBeTruthy();
    expect(screen.getByText(recipeOf(PANCAKE).name)).toBeTruthy();
    expect(screen.getByText(recipeOf("geisha").name)).toBeTruthy();
    // The pancake and the waffle are both Rp 89,000, so the price is on screen
    // more than once — what matters is that it is on screen at all.
    expect(screen.getAllByText("Rp 89.000").length).toBeGreaterThan(0);
  });

  it("offers every dish, whatever the slot is called", () => {
    openDialog();

    // Geisha is a lunch and dinner main. Choosing it for Breakfast is a
    // decision, not a mistake to be prevented.
    expect(screen.getByText(recipeOf("geisha").name)).toBeTruthy();
    expect(menuRecipes.every((recipe) => screen.queryAllByText(recipe.name).length > 0))
      .toBe(true);
  });

  it("searches the menu by name", () => {
    openDialog();
    fireEvent.change(screen.getByPlaceholderText("Search Negrita menu…"),
      { target: { value: "pancake" } });

    expect(screen.getByText(recipeOf(PANCAKE).name)).toBeTruthy();
    expect(screen.queryByText(recipeOf("geisha").name)).toBeNull();
  });

  it("hands back the recipe and the servings, not a copy of the dish", () => {
    const chosen = openDialog();
    fireEvent.click(screen.getByText(recipeOf(PANCAKE).name));

    expect(chosen.recipe?.recipe_id).toBe(PANCAKE);
    expect(chosen.servings).toBe(1);
  });
});

/**
 * The assignment WeekPlanner builds from that choice, and what it is still
 * worth after a save and a reload. Mirrors `assignMenuDish` — the component
 * itself needs the whole planner mounted, so the shape it writes is asserted
 * here against the same helpers the plan reads it with.
 */
describe("a menu dish added by hand", () => {
  const planWith = (assignment: Assignment): Plan => migratePlan(JSON.parse(JSON.stringify({
    id: "primary", ownerUid: "", title: "My week",
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    targets: null, targetMode: "custom",
    mealSlots: ["Breakfast", "Lunch", "Dinner", "Snack"],
    programStartDate: "2026-08-17", weekCount: 1, status: "draft",
    submittedWeeks: [], assignments: [assignment],
  })))!;

  const added = (recipe: MenuRecipe, servings = 1): Assignment => ({
    id: "a1", week: 1, day: 0, slot: "Breakfast", servings,
    items: [], // the kitchen detail is irrelevant to what it costs and counts
    price: { totalIdr: recipe.price_idr ?? 0, complete: true },
    snapshot: { name: recipe.name, totals: publishedMenuMacros(recipe)! },
    menuRecipeId: recipe.recipe_id,
  } as unknown as Assignment);

  it("is worth the menu's price and macros after a save and a reload", () => {
    const recipe = recipeOf(PANCAKE);
    const [assignment] = planWith(added(recipe)).assignments;

    expect(assignment.menuRecipeId).toBe(PANCAKE);
    expect(assignmentPrice(assignment, NO_DISHES).totalIdr).toBe(89_000);
    expect(assignmentMacros(assignment, NO_DISHES)).toEqual(publishedMenuMacros(recipe));
    expect(assignmentMacros(assignment, NO_DISHES).energy_kcal).toBe(1095);
  });

  it("scales with servings", () => {
    const [assignment] = planWith(added(recipeOf("geisha"), 2)).assignments;

    expect(assignmentPrice(assignment, NO_DISHES).totalIdr).toBe(198_000);
    expect(assignmentMacros(assignment, NO_DISHES).energy_kcal).toBe(1160);
  });
});

/**
 * And the copies already sitting in people's libraries, which is how everyone
 * got a menu dish into a plan before there was a menu tab.
 */
describe("a saved copy of a menu dish", () => {
  const savedCopy = (recipe: MenuRecipe, tweak = 0): Dish => ({
    id: "saved-pancake", name: recipe.name,
    createdAt: "", updatedAt: "",
    items: recipe.components.flatMap((component) =>
      component.quantity_g != null
        ? [{ ingredientId: component.ingredient_id, name: component.ingredient_id,
          grams: component.quantity_g + tweak, unitId: "g",
          quantity: component.quantity_g + tweak }]
        : []),
    totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
  } as unknown as Dish);

  const assignmentFor = (dish: Dish): Assignment => ({
    id: "a1", week: 1, day: 0, slot: "Breakfast", servings: 1, dishId: dish.id,
    snapshot: { name: dish.name, totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0,
      fat_g: 0, fiber_g: 0 } },
  } as unknown as Assignment);

  it("is the menu dish, once the plan can see the dish it points at", async () => {
    const { withMenuIdentity } = await import("@/lib/menuIdentity");
    const dish = savedCopy(recipeOf(PANCAKE));
    const resolved = withMenuIdentity(assignmentFor(dish), byId([dish]));

    expect(resolved.menuRecipeId).toBe(PANCAKE);
    expect(assignmentPrice(resolved, byId([dish])).totalIdr).toBe(89_000);
    expect(assignmentMacros(resolved, byId([dish])).energy_kcal).toBe(1095);
  });

  it("stays your own dish once you have changed it", async () => {
    const { withMenuIdentity } = await import("@/lib/menuIdentity");
    const dish = savedCopy(recipeOf(PANCAKE), 1);
    const resolved = withMenuIdentity(assignmentFor(dish), byId([dish]));

    expect(resolved.menuRecipeId).toBeUndefined();
    // Priced and counted from what it is made of, which is what it now is.
    expect(assignmentMacros(resolved, byId([dish])).energy_kcal).not.toBe(1095);
  });

  it("is left alone when the plan has no dishes to look at", async () => {
    const { withMenuIdentity } = await import("@/lib/menuIdentity");
    const dish = savedCopy(recipeOf(PANCAKE));

    expect(withMenuIdentity(assignmentFor(dish)).menuRecipeId).toBeUndefined();
  });
});
