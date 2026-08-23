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

/** Source-independent vocabulary used by the weekly planner. */
export type PlannerCandidateSource =
  | "negrita_menu"
  | "saved_dish"
  | "generated_diy";
export type ProteinFamily =
  | "chicken"
  | "beef"
  | "fish"
  | "eggs"
  | "vegetarian"
  | "other";
export type CarbFamily =
  | "rice"
  | "buckwheat"
  | "oats"
  | "potato"
  | "bread"
  | "wrap"
  | "other";
export type MacroConfidence = "published" | "calculated" | "estimated" | "incomplete";

export interface PlannerCandidateIngredient {
  ingredientId: string;
  name: string;
  grams: number;
  preparation?: string;
}

export interface PlannerModificationOption {
  type: "remove_ingredient" | "add_ingredient";
  ingredientId?: string;
  label: string;
  /** Fixed, operationally-approved amount. The optimizer may not choose one. */
  grams: number;
  /** Nutritional delta applied to the published base dish. */
  macroDelta: Macros;
}

/** One optimizer input, irrespective of where the meal originated. */
export interface PlannerCandidate {
  id: string;
  source: PlannerCandidateSource;
  displayName: string;
  optimizerMacros: Macros;
  /** Ingredient reconstruction retained for QA; never blended into optimizerMacros. */
  calculatedIngredientMacros?: Macros;
  breakdown: PlannerCandidateIngredient[];
  price: { totalIdr: number; complete: boolean };
  proteinFamily: ProteinFamily;
  carbFamily: CarbFamily;
  cuisineFamily: string;
  mealArchetype: string;
  eligibleMealTypes: string[];
  macroConfidence: MacroConfidence;
  /** Menu dishes receive this priority when the menu preference is enabled. */
  readyMadePriority: "high" | "normal";
  modificationOptions: PlannerModificationOption[];
  dietaryTags: string[];
  allergenTags: string[];
  /** Normalized sauce identities, kept separate from general flavor. */
  sauceFamilies: string[];
  /** Stable identity used for exact-dish variety accounting. */
  exactDishIdentity: string;
}

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
  /**
   * Price of one DIY menu portion, in full rupiah. Undefined when the item is
   * not sold as a DIY component — the app must then report the price as unknown
   * rather than guessing.
   */
  price_idr?: number;
  /** Weight of the DIY portion the price buys. */
  diy_portion_g?: number;
  /** Display name of the DIY menu line this ingredient is sold as. */
  diy_name?: string;
  /** Which DIY section it belongs to: carbs | protein | veg | fats. */
  diy_section?: DiySection;
  /** Kitchen constraints used when the planner requests a custom DIY serving. */
  diy_quantity?: DiyQuantityMetadata;
}

export type DiySection = "carbs" | "protein" | "veg" | "fats";

export interface DiyQuantityMetadata {
  minimum_g: number;
  maximum_g: number;
  preferred_g: number;
  increment_g: number;
  /** False for piece/slice items that can only be sold at the preferred size. */
  arbitrary_quantities_supported: boolean;
}

export interface DiyMenuItem {
  id: string;
  name: string;
  section: DiySection;
  portion_g: number;
  price_idr: number;
  ingredient_id: string;
  variants?: string[];
  notes?: string;
  derived_portion?: boolean;
  menu_correction?: string;
  menu_macros: {
    protein_g: number;
    fat_g: number;
    carbs_g: number;
    energy_kcal: number;
  };
}

export interface RecipeComponent {
  ingredient_id: string;
  /** null means the menu did not state the quantity. */
  quantity_g: number | null;
  quantity_status: string;
}

export interface MenuMacrosPerServing extends Partial<Macros> {
  source?: string;
  /** Optional source-level qualification when a database record is uncertain. */
  macro_confidence?: MacroConfidence;
  estimate_confidence?: string;
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
  /** What the dish actually contains, as printed on the menu. */
  description?: string;
  /**
   * Set when the missing gram quantities were derived by fitting the recipe to
   * the macros the menu publishes, rather than printed on the menu itself.
   * `worstPct` is the largest miss across calories, protein, carbs and fat.
   */
  derived_quantities?: { worstPct: number; worstMacro: string };
}

export interface NutritionDatabase {
  schema_version: string;
  database_name: string;
  generated_on: string;
  units: Record<string, string>;
  ingredients: Omit<Ingredient, "units" | "defaultUnitId">[];
  menu_recipes: MenuRecipe[];
}
