import { create } from "zustand";
import type { Ingredient, MenuRecipe } from "@/types/nutrition";
import { getIngredient } from "@/lib/database";
import {
  addItem,
  makeItem,
  removeItem,
  setItemQuantity,
  setItemUnit,
} from "@/lib/dishItems";
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

/**
 * The dish currently being built. Item-level rules live in `lib/dishItems` so
 * the assign dialog's inline builder behaves identically without a second copy.
 */
export const useDishBuilder = create<DishBuilderState>((set, get) => ({
  editingId: null,
  name: "",
  items: [],

  setName: (name) => set({ name }),

  addIngredient: (ingredient) => set({ items: addItem(get().items, ingredient) }),

  removeItem: (ingredientId) =>
    set({ items: removeItem(get().items, ingredientId) }),

  setQuantity: (ingredientId, quantity) =>
    set({ items: setItemQuantity(get().items, ingredientId, quantity) }),

  setUnit: (ingredientId, unitId) =>
    set({ items: setItemUnit(get().items, ingredientId, unitId) }),

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
