import type { CarbFamily, MacroConfidence, PlannerModificationOption,
  ProteinFamily } from "@/types/nutrition";

export interface NegritaPlannerMetadata {
  proteinFamily: ProteinFamily;
  carbFamily: CarbFamily;
  cuisineFamily: string;
  mealArchetype: "breakfast" | "main";
  eligibleMealTypes: string[];
  macroConfidence: MacroConfidence;
  modificationOptions: PlannerModificationOption[];
}

const breakfast = (proteinFamily: ProteinFamily, carbFamily: CarbFamily): NegritaPlannerMetadata => ({
  proteinFamily, carbFamily, cuisineFamily: "breakfast_sweets", mealArchetype: "breakfast",
  eligibleMealTypes: ["breakfast"], macroConfidence: "published", modificationOptions: [],
});
const main = (proteinFamily: ProteinFamily, carbFamily: CarbFamily,
  cuisineFamily: string): NegritaPlannerMetadata => ({
  proteinFamily, carbFamily, cuisineFamily, mealArchetype: "main",
  eligibleMealTypes: ["lunch", "dinner"], macroConfidence: "published", modificationOptions: [],
});

/**
 * Curated facts for every ready Negrita dish. Empty modifications are deliberate:
 * the kitchen has not confirmed fixed increments or removable sides, so the
 * optimizer must use the published dish unchanged.
 */
export const NEGRITA_PLANNER_METADATA: Record<string, NegritaPlannerMetadata> = {
  cheese_cake: breakfast("vegetarian", "other"),
  protein_banana_bread: breakfast("vegetarian", "bread"),
  special_protein_pancake: breakfast("vegetarian", "bread"),
  protein_bountiful_fruit_waffle: breakfast("vegetarian", "bread"),
  oatmeal_banana_peanut_butter: breakfast("vegetarian", "oats"),
  oatmeal_baked_apple_cinnamon: breakfast("vegetarian", "oats"),
  bulking_chicken: main("chicken", "other", "fitness"),
  geisha: main("chicken", "rice", "japanese_teriyaki"),
  breakfast_protein_burrito: { ...main("chicken", "wrap", "mexican_inspired"),
    mealArchetype: "breakfast", eligibleMealTypes: ["breakfast"] },
  chicken_pita: main("chicken", "bread", "mediterranean"),
  thai_boy_beefy: main("beef", "rice", "thai"),
  thai_boy_chicky: main("chicken", "rice", "thai"),
  buckwheat_bluefin_tuna: main("fish", "buckwheat", "japanese"),
  buckwheat_chicken_teriyaki: main("chicken", "buckwheat", "japanese_teriyaki"),
  greek_god_chicken: main("chicken", "bread", "middle_eastern_mediterranean"),
  greek_god_tenderloin: main("beef", "bread", "middle_eastern_mediterranean"),
  greek_god_wagyu: main("beef", "bread", "middle_eastern_mediterranean"),
  greek_god_salmon: main("fish", "bread", "middle_eastern_mediterranean"),
  greek_god_scallops: main("fish", "bread", "middle_eastern_mediterranean"),
  before_cardio: breakfast("eggs", "bread"),
  recovery_salmon: main("fish", "rice", "japanese_teriyaki"),
  bali_boy: main("chicken", "rice", "balinese"),
  beef_ritual_burger: main("beef", "bread", "american"),
  peri_peri_chicken: main("chicken", "rice", "peri_peri"),
  unagi_shogun: main("fish", "rice", "japanese_teriyaki"),
};
