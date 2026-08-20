/**
 * Types modeling the Negrita Nutrition Software Database.
 * Only the fields the app actually uses are typed strictly; the rest of the
 * source record is kept loosely so we never fight the raw JSON shape.
 */

export interface Macros {
  energy_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

export type MacroKey = keyof Macros;

/** The implicit unit every ingredient supports: plain grams. */
export const GRAM_UNIT_ID = "g";

/**
 * A way to measure an ingredient other than by weight — "1 large egg",
 * "1 slice", "1 tbsp". Grams remain authoritative for all macro math;
 * a unit is only a multiplier used at the input surface.
 */
export interface PortionUnit {
  id: string;
  label: string;
  /** Weight of ONE of this unit. */
  gramWeight: number;
  /** Countable things (eggs, slices, pitas) only accept whole numbers. */
  integerOnly?: boolean;
  /** Provenance: "usda" for a real foodPortion, "curated" for hand-added. */
  source?: string;
}

export const GRAM_UNIT: PortionUnit = {
  id: GRAM_UNIT_ID,
  label: "g",
  gramWeight: 1,
};

export interface IngredientSource {
  type?: string;
  fdc_id?: number;
  description?: string;
  publication_date?: string;
  url?: string;
}

export interface Ingredient {
  ingredient_id: string;
  name: string;
  category: string;
  menu_names: string[];
  measurement_basis: string;
  source_status: string;
  source: IngredientSource | null;
  macros_per_100g: Macros;
  flags: string[];
  notes: string | null;
  /** Portion units available for this ingredient, grams always included first. */
  units: PortionUnit[];
  /** Which unit the picker should preselect. */
  defaultUnitId: string;
}

export interface RecipeComponent {
  ingredient_id: string;
  /** null means the menu did not state the quantity. */
  quantity_g: number | null;
  quantity_status: string;
}

export interface MenuMacrosPerServing extends Partial<Macros> {
  source?: string;
}

export interface MenuRecipe {
  recipe_id: string;
  name: string;
  section: string;
  variant_of: string | null;
  price_idr: number | null;
  menu_macros_per_serving: MenuMacrosPerServing;
  components: RecipeComponent[];
  recipe_calculation_ready: boolean;
  notes: string | null;
  quantity_complete: boolean;
}

export interface NutritionDatabase {
  schema_version: string;
  database_name: string;
  generated_on: string;
  units: Record<string, string>;
  ingredients: Omit<Ingredient, "units" | "defaultUnitId">[];
  menu_recipes: MenuRecipe[];
}
