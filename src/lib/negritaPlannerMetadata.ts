import type { CarbFamily, MacroConfidence, PlannerModificationOption,
  ProteinFamily } from "@/types/nutrition";

export interface NegritaPlannerMetadata {
  proteinFamily: ProteinFamily;
  carbFamily: CarbFamily;
  cuisineFamily: string;
  mealArchetype: "breakfast" | "main";
  /** Culinary style, used for slot-level variety. See PlannerCandidate.dishStyle. */
  dishStyle: string;
  eligibleMealTypes: string[];
  macroConfidence: MacroConfidence;
  modificationOptions: PlannerModificationOption[];
}

const breakfast = (proteinFamily: ProteinFamily, carbFamily: CarbFamily,
  dishStyle: string): NegritaPlannerMetadata => ({
  proteinFamily, carbFamily, cuisineFamily: "breakfast_sweets", mealArchetype: "breakfast",
  dishStyle, eligibleMealTypes: ["breakfast"], macroConfidence: "published",
  modificationOptions: [],
});
const main = (proteinFamily: ProteinFamily, carbFamily: CarbFamily,
  cuisineFamily: string, dishStyle: string): NegritaPlannerMetadata => ({
  proteinFamily, carbFamily, cuisineFamily, mealArchetype: "main", dishStyle,
  eligibleMealTypes: ["lunch", "dinner"], macroConfidence: "published",
  modificationOptions: [],
});

/**
 * Curated facts for every ready Negrita dish. Empty modifications are deliberate:
 * the kitchen has not confirmed fixed increments or removable sides, so the
 * optimizer must use the published dish unchanged.
 *
 * `dishStyle` is what stops one breakfast becoming the default. Every breakfast
 * used to be filed as the same archetype and the same cuisine, so nothing in the
 * optimizer could tell a pancake from an oatmeal bowl from Before Cardio, and
 * "rotate the styles" was not a request it could act on. The styles below are
 * how a person would describe the plate, not how the kitchen files it.
 *
 * The protein families are the ones the dish actually leads with. Before Cardio
 * is banana, fruit, honey and toast bound with egg white — a sweet breakfast,
 * not an egg plate — and filing it as the sole `eggs` breakfast put it in a
 * repeat bucket of its own while the genuinely sweet breakfasts crowded each
 * other out of `vegetarian`.
 */
export const NEGRITA_PLANNER_METADATA: Record<string, NegritaPlannerMetadata> = {
  cheese_cake: breakfast("vegetarian", "other", "cheesecake"),
  protein_banana_bread: breakfast("vegetarian", "bread", "bakery"),
  special_protein_pancake: breakfast("vegetarian", "bread", "pancake"),
  protein_bountiful_fruit_waffle: breakfast("vegetarian", "bread", "waffle"),
  oatmeal_banana_peanut_butter: breakfast("vegetarian", "oats", "oatmeal"),
  oatmeal_baked_apple_cinnamon: breakfast("vegetarian", "oats", "oatmeal"),
  before_cardio: breakfast("vegetarian", "bread", "fruit-and-toast"),
  breakfast_protein_burrito: { ...main("chicken", "wrap", "mexican_inspired", "hearty-savoury"),
    mealArchetype: "breakfast", eligibleMealTypes: ["breakfast"] },
  bulking_chicken: main("chicken", "other", "fitness", "fitness-plate"),
  geisha: main("chicken", "rice", "japanese_teriyaki", "teriyaki-bowl"),
  chicken_pita: main("chicken", "bread", "mediterranean", "pita-wrap"),
  thai_boy_beefy: main("beef", "rice", "thai", "thai-rice-bowl"),
  thai_boy_chicky: main("chicken", "rice", "thai", "thai-rice-bowl"),
  buckwheat_bluefin_tuna: main("fish", "buckwheat", "japanese", "sashimi-grain-bowl"),
  buckwheat_chicken_teriyaki: main("chicken", "buckwheat", "japanese_teriyaki", "teriyaki-grain-bowl"),
  // The five Greek God variants are one plate with the protein swapped, which is
  // exactly the kind of "different dish, same dinner" the style dimension exists
  // to catch.
  greek_god_chicken: main("chicken", "bread", "middle_eastern_mediterranean", "kebab-plate"),
  greek_god_tenderloin: main("beef", "bread", "middle_eastern_mediterranean", "kebab-plate"),
  greek_god_wagyu: main("beef", "bread", "middle_eastern_mediterranean", "kebab-plate"),
  greek_god_salmon: main("fish", "bread", "middle_eastern_mediterranean", "kebab-plate"),
  greek_god_scallops: main("fish", "bread", "middle_eastern_mediterranean", "kebab-plate"),
  recovery_salmon: main("fish", "rice", "japanese_teriyaki", "teriyaki-bowl"),
  bali_boy: main("chicken", "rice", "balinese", "balinese-plate"),
  beef_ritual_burger: main("beef", "bread", "american", "burger"),
  peri_peri_chicken: main("chicken", "rice", "peri_peri", "peri-peri-plate"),
  unagi_shogun: main("fish", "rice", "japanese_teriyaki", "eel-rice-bowl"),
};
