import { create } from "zustand";
import type { Ingredient, MenuRecipe } from "@/types/nutrition";
import { getIngredient } from "@/lib/database";
import type { Dish, DishItem } from "@/lib/storage/types";

interface DishBuilderState {
  /** Set when editing/continuing a previously saved dish; null for a new one. */
  editingId: string | null;
  name: string;
  items: DishItem[];

  setName: (name: string) => void;
  addIngredient: (ingredient: Ingredient) => void;
  removeItem: (ingredientId: string) => void;
  setGrams: (ingredientId: string, grams: number) => void;
  hasIngredient: (ingredientId: string) => boolean;
  loadTemplate: (recipe: MenuRecipe) => void;
  loadDish: (dish: Dish) => void;
  reset: () => void;
}

const DEFAULT_GRAMS = 100;

export const useDishBuilder = create<DishBuilderState>((set, get) => ({
  editingId: null,
  name: "",
  items: [],

  setName: (name) => set({ name }),

  addIngredient: (ingredient) => {
    if (get().items.some((it) => it.ingredientId === ingredient.ingredient_id)) {
      return; // already in the dish; grams are adjusted in the cart
    }
    const item: DishItem = {
      ingredientId: ingredient.ingredient_id,
      name: ingredient.name,
      grams: DEFAULT_GRAMS,
    };
    set({ items: [...get().items, item] });
  },

  removeItem: (ingredientId) =>
    set({ items: get().items.filter((it) => it.ingredientId !== ingredientId) }),

  setGrams: (ingredientId, grams) =>
    set({
      items: get().items.map((it) =>
        it.ingredientId === ingredientId
          ? { ...it, grams: Number.isFinite(grams) && grams >= 0 ? grams : 0 }
          : it
      ),
    }),

  hasIngredient: (ingredientId) =>
    get().items.some((it) => it.ingredientId === ingredientId),

  loadTemplate: (recipe) => {
    const items: DishItem[] = recipe.components
      .map((c) => {
        const ing = getIngredient(c.ingredient_id);
        if (!ing) return null;
        return {
          ingredientId: c.ingredient_id,
          name: ing.name,
          // Menu-missing quantities load as 0 so staff can set them.
          grams: c.quantity_g ?? 0,
        } satisfies DishItem;
      })
      .filter((x): x is DishItem => x !== null);
    set({ editingId: null, name: recipe.name, items });
  },

  loadDish: (dish) =>
    set({ editingId: dish.id, name: dish.name, items: dish.items }),

  reset: () => set({ editingId: null, name: "", items: [] }),
}));
