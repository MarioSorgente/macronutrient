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
  /** Set when the meal came from a saved dish. Absent for generated meals. */
  dishId?: string;
  /**
   * Ingredients of a meal built by the auto-planner. Held inline so generated
   * plans do not flood the saved-dish library; a meal worth keeping can still
   * be saved as a dish explicitly.
   */
  items?: DishItem[];
  servings: number;
  /**
   * Known cost of one serving. Set when the meal has an authoritative price —
   * a menu dish is sold for its menu price, not the sum of its parts — so the
   * plan does not re-derive a different (and partial) figure from components.
   */
  price?: { totalIdr: number; complete: boolean };
  /**
   * Coach mark-up for this meal, **per serving**, in full rupiah. Same basis as
   * `price`, so it stays correct when servings change. May only ever be above
   * the calculated price — the menu figure is a floor, never undercut.
   */
  priceOverrideIdr?: number;
  /**
   * Copy of the meal at assignment time. Keeps a plan readable even if the
   * dish is later deleted; the live dish wins whenever it still exists.
   */
  snapshot: { name: string; totals: Macros };
}

export type MacroStyle =
  | "high_protein"
  | "balanced"
  | "low_carb"
  | "high_carb";

export type ProteinSource =
  | "chicken"
  | "beef"
  | "fish"
  | "eggs"
  | "pork"
  | "veg";

/**
 * What a client likes. `proteinLean` biases the mix toward those sources
 * without ever excluding the others; `avoidIngredientIds` is the hard rule,
 * because a dislike or allergy is not a preference.
 */
export interface ClientPreferences {
  macroStyle: MacroStyle;
  proteinLean: ProteinSource[];
  avoidIngredientIds: string[];
}

export const DEFAULT_PREFERENCES: ClientPreferences = {
  macroStyle: "balanced",
  proteinLean: [],
  avoidIngredientIds: [],
};

export interface Client extends Entity {
  name: string;
  notes?: string;
  /** Optional daily goals; adherence UI only appears when this is set. */
  targets: MacroTargets | null;
  /** Tastes, remembered between generations. */
  preferences?: ClientPreferences;
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
