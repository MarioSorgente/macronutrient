import type { Macros } from "@/types/nutrition";

/** Everything we persist is keyed by id and carries timestamps for sorting. */
export interface Entity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

// --- Dishes -----------------------------------------------------------------

export interface DishItem {
  ingredientId: string;
  /** Name captured at save time so reports render even if data changes later. */
  name: string;
  /** Authoritative amount for all macro math. */
  grams: number;
  /** Portion unit the user is working in ("g" for plain grams). */
  unitId: string;
  /** Amount expressed in `unitId`; grams = quantity * unit.gramWeight. */
  quantity: number;
}

export interface Dish extends Entity {
  name: string;
  items: DishItem[];
  /** Cached totals at save time (also recomputed live when rendering). */
  totals: Macros;
}

// --- Clients ----------------------------------------------------------------

export interface MacroTargets {
  energy_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface Assignment {
  id: string;
  /** 1-based week within the program (1..weekCount). */
  week: number;
  /** 0 = Monday .. 6 = Sunday. */
  day: number;
  /** Meal slot name, matching one of the client's `mealSlots`. */
  slot: string;
  dishId: string;
  servings: number;
  /**
   * Copy of the dish at assignment time. Keeps a plan readable even if the
   * dish is later deleted; the live dish wins whenever it still exists.
   */
  snapshot: { name: string; totals: Macros };
}

export interface Client extends Entity {
  name: string;
  notes?: string;
  /** Optional daily goals; adherence UI only appears when this is set. */
  targets: MacroTargets | null;
  /** Editable meal slot names, e.g. ["Breakfast", "Lunch", "Dinner"]. */
  mealSlots: string[];
  /** ISO date (yyyy-mm-dd) of week 1, day 1. */
  programStartDate: string;
  /** Program length in weeks, 1..6. */
  weekCount: number;
  plan: Assignment[];
}

export const MAX_PROGRAM_WEEKS = 6;

export const DEFAULT_MEAL_SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];

// --- House recipes ----------------------------------------------------------

export interface HouseRecipeComponent {
  ingredientId: string;
  grams: number;
}

/**
 * A Negrita house item defined from its own components. Lets the restaurant
 * replace an estimated proxy with exact values: per-100 g macros are derived as
 * sum(components) / yieldGrams * 100.
 */
export interface HouseRecipe extends Entity {
  /** id === the ingredient_id this recipe overrides. */
  ingredientId: string;
  components: HouseRecipeComponent[];
  /** Finished batch weight after cooking/mixing. */
  yieldGrams: number;
}

// --- Repository -------------------------------------------------------------

/**
 * Persistence contract. The localStorage implementation (used now) and the
 * Firestore implementation (prepared for later) both satisfy it, so swapping
 * backends requires no changes to UI or logic.
 */
export interface Repository<T extends Entity> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  save(entity: T): Promise<T>;
  remove(id: string): Promise<void>;
}

export type DishRepository = Repository<Dish>;
export type ClientRepository = Repository<Client>;
export type HouseRecipeRepository = Repository<HouseRecipe>;
