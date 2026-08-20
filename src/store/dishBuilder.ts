import { create } from "zustand";
import { GRAM_UNIT_ID, type Ingredient, type MenuRecipe } from "@/types/nutrition";
import { getIngredient } from "@/lib/database";
import { findUnit, fromGrams, normalizeQuantity, toGrams } from "@/lib/units";
import type { Dish, DishItem } from "@/lib/storage/types";

interface DishBuilderState {
  /** Set when editing/continuing a previously saved dish; null for a new one. */
  editingId: string | null;
  name: string;
  items: DishItem[];

  setName: (name: string) => void;
  addIngredient: (ingredient: Ingredient) => void;
  removeItem: (ingredientId: string) => void;
  setQuantity: (ingredientId: string, quantity: number) => void;
  setUnit: (ingredientId: string, unitId: string) => void;
  hasIngredient: (ingredientId: string) => boolean;
  loadTemplate: (recipe: MenuRecipe) => void;
  loadDish: (dish: Dish) => void;
  reset: () => void;
}

const DEFAULT_GRAMS = 100;

/** Builds a dish item using the ingredient's most natural unit. */
function makeItem(ingredient: Ingredient, grams?: number): DishItem {
  const unit = findUnit(ingredient, ingredient.defaultUnitId);

  if (typeof grams === "number") {
    return {
      ingredientId: ingredient.ingredient_id,
      name: ingredient.name,
      grams,
      unitId: unit.id,
      quantity: fromGrams(unit, grams),
    };
  }

  // A countable ingredient starts at one piece; anything weighed starts at 100 g.
  const quantity = unit.id === GRAM_UNIT_ID ? DEFAULT_GRAMS : 1;
  return {
    ingredientId: ingredient.ingredient_id,
    name: ingredient.name,
    grams: toGrams(unit, quantity),
    unitId: unit.id,
    quantity,
  };
}

export const useDishBuilder = create<DishBuilderState>((set, get) => ({
  editingId: null,
  name: "",
  items: [],

  setName: (name) => set({ name }),

  addIngredient: (ingredient) => {
    if (get().items.some((it) => it.ingredientId === ingredient.ingredient_id)) {
      return; // already in the dish; the amount is adjusted in the cart
    }
    set({ items: [...get().items, makeItem(ingredient)] });
  },

  removeItem: (ingredientId) =>
    set({ items: get().items.filter((it) => it.ingredientId !== ingredientId) }),

  setQuantity: (ingredientId, quantity) =>
    set({
      items: get().items.map((it) => {
        if (it.ingredientId !== ingredientId) return it;
        const unit = findUnit(getIngredient(ingredientId), it.unitId);
        const next = normalizeQuantity(unit, quantity);
        return { ...it, quantity: next, grams: toGrams(unit, next) };
      }),
    }),

  /** Switching units preserves the weight, so "100 g" becomes "2 large eggs". */
  setUnit: (ingredientId, unitId) =>
    set({
      items: get().items.map((it) => {
        if (it.ingredientId !== ingredientId) return it;
        const unit = findUnit(getIngredient(ingredientId), unitId);
        const quantity = fromGrams(unit, it.grams);
        return { ...it, unitId, quantity, grams: toGrams(unit, quantity) };
      }),
    }),

  hasIngredient: (ingredientId) =>
    get().items.some((it) => it.ingredientId === ingredientId),

  loadTemplate: (recipe) => {
    const items: DishItem[] = recipe.components
      .map((c) => {
        const ing = getIngredient(c.ingredient_id);
        if (!ing) return null;
        // Menu-missing quantities load as 0 so staff can fill them in.
        return makeItem(ing, c.quantity_g ?? 0);
      })
      .filter((x): x is DishItem => x !== null);
    set({ editingId: null, name: recipe.name, items });
  },

  loadDish: (dish) =>
    set({ editingId: dish.id, name: dish.name, items: dish.items }),

  reset: () => set({ editingId: null, name: "", items: [] }),
}));
