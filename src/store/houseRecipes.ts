import { create } from "zustand";
import type { Macros } from "@/types/nutrition";
import { houseRecipeMacrosPer100g } from "@/lib/calc";
import { setHouseOverrides } from "@/lib/database";
import { getHouseRecipeRepository } from "@/lib/storage";
import type { HouseRecipe } from "@/lib/storage/types";

interface HouseRecipeState {
  recipes: HouseRecipe[];
  loaded: boolean;
  /**
   * Bumped whenever overrides change. Components that display ingredient values
   * subscribe to it so they re-render once a house recipe is defined or removed.
   */
  version: number;

  load: () => Promise<void>;
  save: (recipe: HouseRecipe) => Promise<void>;
  remove: (id: string) => Promise<void>;
  getRecipeFor: (ingredientId: string) => HouseRecipe | undefined;
}

/** Recompute per-100 g values for every defined recipe and push them into the DB layer. */
function applyOverrides(recipes: HouseRecipe[]): void {
  const overrides = new Map<string, Macros>();
  for (const recipe of recipes) {
    const macros = houseRecipeMacrosPer100g(
      recipe.components.map((c) => ({
        ingredientId: c.ingredientId,
        grams: c.grams,
      })),
      recipe.yieldGrams
    );
    if (macros) overrides.set(recipe.ingredientId, macros);
  }
  setHouseOverrides(overrides);
}

// A route transition can briefly mount two consumers. Share the in-flight read
// as well as the resolved Zustand state so it still produces one request.
let loadPromise: Promise<void> | null = null;

export const useHouseRecipes = create<HouseRecipeState>((set, get) => ({
  recipes: [],
  loaded: false,
  version: 0,

  load: async () => {
    if (get().loaded) return;
    if (!loadPromise) {
      loadPromise = getHouseRecipeRepository()
        .list()
        .then((recipes) => {
          applyOverrides(recipes);
          set({ recipes, loaded: true, version: get().version + 1 });
        })
        .finally(() => {
          loadPromise = null;
        });
    }
    await loadPromise;
  },

  save: async (recipe) => {
    await getHouseRecipeRepository().save(recipe);
    const recipes = await getHouseRecipeRepository().list();
    applyOverrides(recipes);
    set({ recipes, version: get().version + 1 });
  },

  remove: async (id) => {
    await getHouseRecipeRepository().remove(id);
    const recipes = await getHouseRecipeRepository().list();
    applyOverrides(recipes);
    set({ recipes, version: get().version + 1 });
  },

  getRecipeFor: (ingredientId) =>
    get().recipes.find((r) => r.ingredientId === ingredientId),
}));
