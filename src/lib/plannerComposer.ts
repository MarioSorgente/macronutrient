import { GRAM_UNIT_ID, type DiySection, type Ingredient, type Macros,
  type PlannerCandidate } from "@/types/nutrition";
import { getIngredient, houseOverridesVersion, nutritionCatalog } from "@/lib/database";
import { perItemMacros } from "@/lib/calc";
import { quantitiesNearResidual } from "@/lib/diyQuantities";
import { macroDistance } from "@/lib/macroFit";
import { generatedDiyCandidate } from "@/lib/plannerCandidates";
import {
  MEAL_TEMPLATES,
  ingredientFamily,
  sectionsForRole,
  templateRoles,
  templatesForSlot,
  type MealComponentRole,
  type MealTemplate,
} from "@/lib/mealTemplates";
import { isDinnerOnlyIngredient, slotKindOf } from "@/lib/slotSuitability";
import { kindOfMealTime, type MealTime } from "@/lib/mealTime";
import type { ClientPreferences, DishItem, MacroTargets } from "@/lib/storage/types";

/**
 * Build-your-own meals, composed against the macros a day still has left.
 *
 * The composer is deliberately a *function of the residual*. The whole-day
 * solver calls it again at every slot with what remains after the meals already
 * chosen, so a large Geisha lunch is answered with a dinner actually sized for
 * the 780 kcal that survived it — not with a portion computed before lunch was
 * picked.
 *
 * Two rules keep that honest:
 *
 *  - Templates, not protein-and-carb. A salad needs a protein and a vegetable
 *    and may skip the carb; a pre-workout meal needs the carb and may skip the
 *    protein. Roles come from the archetype, so the optimizer gets the
 *    combinations the kitchen actually serves.
 *  - Retention is scored, never "the first N generated". Iteration order over
 *    the DIY catalog decides nothing: candidates are ranked, and the kept set is
 *    padded by anchor so beef, fish and eggs cannot be crowded out by whichever
 *    chicken line happens to be listed first.
 */

export interface ComposeRequest {
  slot: string;
  /**
   * The meal time the slot stands for, resolved with its position in the day.
   * Without it an unrecognised slot name falls back to the main archetype, so a
   * plan whose slots are called "Meal 1..3" composed a dinner plate for the
   * morning.
   */
  mealTime?: MealTime;
  /** Daily macros still to be covered, including this slot. */
  residual: MacroTargets;
  /** How many slots (this one included) still have to be filled. */
  slotsRemaining: number;
  /** Share of the remaining slots' appetite this one should carry. */
  slotShare?: number;
  preferences: ClientPreferences;
  /** Rupiah still available for the day, or null when no budget is set. */
  budgetRemainingIdr: number | null;
  maxCandidates?: number;
}

/** How much of a meal each role is expected to contribute, before fitting. */
const ROLE_SHARE: Record<MealComponentRole,
  { energy: number; protein: number; carbs: number; fat: number }> = {
  protein: { energy: 0.45, protein: 0.75, carbs: 0.1, fat: 0.45 },
  carb: { energy: 0.4, protein: 0.15, carbs: 0.8, fat: 0.15 },
  vegetable: { energy: 0.08, protein: 0.05, carbs: 0.12, fat: 0.05 },
  fat: { energy: 0.15, protein: 0.05, carbs: 0.05, fat: 0.35 },
  sauce: { energy: 0.1, protein: 0.05, carbs: 0.05, fat: 0.25 },
};

/** Roles the enumeration walks exhaustively; the rest are fitted greedily. */
const PRIMARY_ROLE_ORDER: MealComponentRole[] = ["protein", "carb", "vegetable"];
const CLOSER_ROLE_ORDER: MealComponentRole[] = ["vegetable", "fat", "sauce"];

/** Portion variants kept per ingredient pair before the closers run. */
const GRAM_COMBINATIONS_PER_PAIR = 3;
/** Portion variants offered per ingredient for a greedily fitted role. */
const CLOSER_VARIANTS_PER_INGREDIENT = 2;
const DEFAULT_MAX_CANDIDATES = 72;
/**
 * How much better an optional component has to make the fit before it earns a
 * place. Without a floor the optimizer bolts a 40,000 rupiah cheese onto every
 * plate for a thousandth of a tolerance unit, and a composed dinner costs three
 * times what it needs to.
 */
const OPTIONAL_ROLE_MIN_GAIN = 0.05;
/**
 * Fits this close are the same meal nutritionally. Price is allowed to decide
 * between them — and only between them; it never reorders candidates that
 * differ meaningfully on macros, and it takes no part in the day-level search.
 */
const FIT_EQUIVALENCE = 0.06;
/** Share of the kept set awarded on macro fit alone, before anchor padding. */
const MACRO_TIER_SHARE = 0.55;

interface DiyLine {
  ingredient: Ingredient;
  section: DiySection;
  priceIdr: number;
  portionG: number;
}

let diyLineCache: DiyLine[] | null = null;
let diyLineCacheVersion = -1;

/**
 * The DIY components the composer can build a meal from.
 *
 * Cached, but keyed on the house-override version: these lines hold resolved
 * `Ingredient` objects, and `getIngredient` folds Negrita's real recipe into
 * the macros. House recipes load from Firestore after the planner has already
 * rendered, so a cache built once kept composing every DIY meal from the
 * bundled estimate — including after the owner edited the recipe.
 */
function diyLines(): DiyLine[] {
  const version = houseOverridesVersion();
  if (diyLineCache && diyLineCacheVersion === version) return diyLineCache;
  const seen = new Set<string>();
  const lines: DiyLine[] = [];
  for (const item of nutritionCatalog.diyMenu) {
    const key = `${item.section}:${item.ingredient_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ingredient = getIngredient(item.ingredient_id);
    if (!ingredient?.diy_quantity) continue;
    lines.push({ ingredient, section: item.section, priceIdr: item.price_idr,
      portionG: item.portion_g });
  }
  diyLineCache = lines;
  diyLineCacheVersion = version;
  return lines;
}

/** Test seam: the composer entry points do far more than resolve these lines. */
export const __diyLinesForTests = diyLines;

interface RoleOption {
  line: DiyLine;
  grams: number;
  priceIdr: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  key: string;
}

function scaleAim(aim: MacroTargets, role: MealComponentRole): MacroTargets {
  const share = ROLE_SHARE[role];
  return {
    energy_kcal: aim.energy_kcal * share.energy,
    protein_g: aim.protein_g * share.protein,
    carbs_g: aim.carbs_g * share.carbs,
    fat_g: aim.fat_g * share.fat,
  };
}

function optionFor(line: DiyLine, grams: number): RoleOption {
  const macros = perItemMacros(line.ingredient, grams);
  const portions = Math.max(1, Math.ceil(grams / line.portionG));
  return {
    line, grams, priceIdr: line.priceIdr * portions,
    kcal: macros.energy_kcal, protein: macros.protein_g, carbs: macros.carbs_g,
    fat: macros.fat_g, fiber: macros.fiber_g,
    key: `${line.ingredient.ingredient_id}:${grams}`,
  };
}

/**
 * Portion choices for one ingredient in one role: the kitchen-snapped optimum
 * for this residual and its immediate neighbours, plus the portion the menu
 * actually sells, which keeps composed meals recognisable.
 */
function optionsForRole(aim: MacroTargets, role: MealComponentRole,
  avoid: readonly string[]): RoleOption[] {
  const roleAim = scaleAim(aim, role);
  const sections = sectionsForRole(role);
  const out: RoleOption[] = [];
  for (const line of diyLines()) {
    if (!sections.includes(line.section)) continue;
    if (avoid.includes(line.ingredient.ingredient_id)) continue;
    const grams = new Set(quantitiesNearResidual(line.ingredient, roleAim));
    grams.add(line.ingredient.diy_quantity!.preferred_g);
    for (const value of [...grams].sort((a, b) => a - b)) {
      if (value > 0) out.push(optionFor(line, value));
    }
  }
  return out;
}

const familyCache = new Map<string, string>();

function cachedFamily(ingredient: Ingredient, role: MealComponentRole): string {
  const key = `${ingredient.ingredient_id}|${role}`;
  const hit = familyCache.get(key);
  if (hit !== undefined) return hit;
  const value = ingredientFamily(ingredient, role);
  familyCache.set(key, value);
  return value;
}

function optionFitsRole(template: MealTemplate, option: RoleOption,
  role: MealComponentRole): boolean {
  const range = template.quantities[role];
  if (range && (option.grams < range.minG || option.grams > range.maxG)) return false;
  return template.compatibleFamilies[role].includes(cachedFamily(option.line.ingredient, role));
}

/** Options for one role, grouped by ingredient so portion variants stay together. */
function groupByIngredient(options: RoleOption[]): RoleOption[][] {
  const groups = new Map<string, RoleOption[]>();
  for (const option of options) {
    const id = option.line.ingredient.ingredient_id;
    const group = groups.get(id);
    if (group) group.push(option); else groups.set(id, [option]);
  }
  return [...groups.values()];
}

function trimVariants(options: RoleOption[], aim: MacroTargets,
  role: MealComponentRole): RoleOption[] {
  const roleAim = scaleAim(aim, role);
  return groupByIngredient(options).flatMap((group) =>
    [...group]
      .sort((a, b) =>
        (macroDistance(a.kcal, a.protein, a.carbs, a.fat, roleAim) -
          macroDistance(b.kcal, b.protein, b.carbs, b.fat, roleAim)) ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, CLOSER_VARIANTS_PER_INGREDIENT));
}

interface Draft {
  parts: RoleOption[];
  roles: MealComponentRole[];
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  priceIdr: number;
}

function addPart(draft: Draft, option: RoleOption, role: MealComponentRole): void {
  draft.parts.push(option);
  draft.roles.push(role);
  draft.kcal += option.kcal;
  draft.protein += option.protein;
  draft.carbs += option.carbs;
  draft.fat += option.fat;
  draft.fiber += option.fiber;
  draft.priceIdr += option.priceIdr;
}

function draftDistance(draft: Draft, aim: MacroTargets): number {
  return macroDistance(draft.kcal, draft.protein, draft.carbs, draft.fat, aim);
}

interface ComposedDraft {
  templateId: string;
  templateName: string;
  parts: RoleOption[];
  roles: MealComponentRole[];
  macros: Macros;
  priceIdr: number;
  score: number;
  anchorId: string;
  identity: string;
}

/**
 * The primary roles are enumerated exhaustively; everything else is fitted.
 * Protein and carbohydrate move the macros most, so they are the pair worth
 * spending the combinatorics on — but only when the archetype uses them at all,
 * which is what lets a salad drop the carb and a pre-workout meal drop the
 * protein rather than pretending both are mandatory everywhere.
 */
function primaryRoles(template: MealTemplate): MealComponentRole[] {
  const usable = templateRoles(template);
  const chosen = PRIMARY_ROLE_ORDER.filter((role) => usable.includes(role));
  return chosen.slice(0, 2);
}

export function composeCandidatesForResidual(
  request: ComposeRequest
): PlannerCandidate[] {
  const share = request.slotShare ?? 1 / Math.max(1, request.slotsRemaining);
  const aim: MacroTargets = {
    energy_kcal: Math.max(request.residual.energy_kcal * share, 60),
    protein_g: Math.max(request.residual.protein_g * share, 4),
    carbs_g: Math.max(request.residual.carbs_g * share, 4),
    fat_g: Math.max(request.residual.fat_g * share, 2),
  };
  const avoid = request.preferences.avoidIngredientIds;
  const breakfast = (request.mealTime
    ? kindOfMealTime(request.mealTime)
    : slotKindOf(request.slot)) === "breakfast";
  const budget = request.budgetRemainingIdr;

  const byRole = new Map<MealComponentRole, RoleOption[]>();
  for (const role of ["protein", "carb", "vegetable", "fat", "sauce"] as const) {
    byRole.set(role, optionsForRole(aim, role, avoid));
  }

  const drafts: ComposedDraft[] = [];

  // The meal time doubles as the archetype key ("breakfast", "lunch", ...),
  // so a resolved slot picks its templates directly rather than by name match.
  for (const template of templatesForSlot(request.mealTime ?? request.slot)) {
    const usable = templateRoles(template);
    const eligible = new Map<MealComponentRole, RoleOption[]>();
    for (const role of usable) {
      const options = (byRole.get(role) ?? []).filter((option) => {
        if (breakfast && isDinnerOnlyIngredient(option.line.ingredient.ingredient_id)) {
          return false;
        }
        return optionFitsRole(template, option, role);
      });
      eligible.set(role, options);
    }

    const primary = primaryRoles(template);
    if (primary.some((role) => template.requiredRoles.includes(role) &&
        !(eligible.get(role) ?? []).length)) {
      continue;
    }

    // A role the archetype marks optional contributes an explicit "omit" branch,
    // so a salad without a carbohydrate competes on macros with one that has it.
    const branches = primary.map((role) => {
      const groups = groupByIngredient(eligible.get(role) ?? []);
      return template.requiredRoles.includes(role)
        ? groups.map((group) => ({ role, group }))
        : [{ role, group: [] as RoleOption[] }, ...groups.map((group) => ({ role, group }))];
    });
    const [first, second] = [branches[0] ?? [], branches[1] ?? [{ role: primary[0], group: [] }]];

    const closers = new Map<MealComponentRole, RoleOption[]>();
    for (const role of usable) {
      if (primary.includes(role)) continue;
      closers.set(role, trimVariants(eligible.get(role) ?? [], aim, role));
    }

    for (const branchA of first) {
      for (const branchB of second) {
        const optionsA: (RoleOption | null)[] = branchA.group.length ? branchA.group : [null];
        const optionsB: (RoleOption | null)[] = branchB.group.length ? branchB.group : [null];
        if (!optionsA[0] && !optionsB[0]) continue;

        const best: { a: RoleOption | null; b: RoleOption | null; score: number }[] = [];
        for (const a of optionsA) {
          for (const b of optionsB) {
            const kcal = (a?.kcal ?? 0) + (b?.kcal ?? 0);
            if (kcal > template.mealSize.maxKcal) continue;
            const score = macroDistance(kcal, (a?.protein ?? 0) + (b?.protein ?? 0),
              (a?.carbs ?? 0) + (b?.carbs ?? 0), (a?.fat ?? 0) + (b?.fat ?? 0), aim);
            best.push({ a, b, score });
          }
        }
        best.sort((x, y) => (x.score - y.score) ||
          ((x.a?.key ?? "") + (x.b?.key ?? "") < (y.a?.key ?? "") + (y.b?.key ?? "") ? -1 : 1));

        for (const base of best.slice(0, GRAM_COMBINATIONS_PER_PAIR)) {
          const draft: Draft = { parts: [], roles: [], kcal: 0, protein: 0, carbs: 0,
            fat: 0, fiber: 0, priceIdr: 0 };
          if (base.a) addPart(draft, base.a, branchA.role);
          if (base.b) addPart(draft, base.b, branchB.role);

          let viable = true;
          for (const role of CLOSER_ROLE_ORDER) {
            const options = closers.get(role);
            if (!options) continue;
            const required = template.requiredRoles.includes(role);
            if (!required && draft.kcal >= template.mealSize.maxKcal) continue;
            let bestOption: RoleOption | null = null;
            let bestScore = required ? Number.POSITIVE_INFINITY
              : draftDistance(draft, aim) - OPTIONAL_ROLE_MIN_GAIN;
            for (const option of options) {
              if (draft.kcal + option.kcal > template.mealSize.maxKcal) continue;
              const score = macroDistance(draft.kcal + option.kcal,
                draft.protein + option.protein, draft.carbs + option.carbs,
                draft.fat + option.fat, aim);
              if (score < bestScore ||
                  (score === bestScore && bestOption && option.key < bestOption.key)) {
                bestScore = score;
                bestOption = option;
              }
            }
            if (bestOption) addPart(draft, bestOption, role);
            else if (required) { viable = false; break; }
          }
          if (!viable) continue;
          if (template.requiredRoles.some((role) => !draft.roles.includes(role))) continue;
          if (draft.kcal < template.mealSize.minKcal ||
              draft.kcal > template.mealSize.maxKcal) continue;
          if (budget !== null && draft.priceIdr > budget) continue;

          const ordered = [...draft.parts].sort((a, b) =>
            a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
          drafts.push({
            templateId: template.id,
            templateName: template.name,
            parts: draft.parts,
            roles: draft.roles,
            macros: { energy_kcal: draft.kcal, protein_g: draft.protein,
              carbs_g: draft.carbs, fat_g: draft.fat, fiber_g: draft.fiber },
            priceIdr: draft.priceIdr,
            score: draftDistance(draft, aim),
            anchorId: draft.parts[0]?.line.ingredient.ingredient_id ?? template.id,
            identity: `${template.id}:${ordered.map((part) => part.key).join("+")}`,
          });
        }
      }
    }
  }

  return materialize(retain(drafts, request.maxCandidates ?? DEFAULT_MAX_CANDIDATES));
}

/**
 * Two tiers, because either alone is wrong. Macro fit alone returns nine
 * variations of the same chicken; anchor coverage alone throws away the portion
 * precision the day needs to land on target. So: keep the best fits, then walk
 * the anchors round-robin and give each its best surviving option.
 */
function retain(drafts: ComposedDraft[], cap: number): ComposedDraft[] {
  const tier = (draft: ComposedDraft) => Math.round(draft.score / FIT_EQUIVALENCE);
  const ordered = [...drafts].sort((a, b) => (tier(a) - tier(b)) ||
    (a.priceIdr - b.priceIdr) ||
    (a.score - b.score) ||
    (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0));
  const kept: ComposedDraft[] = [];
  const seen = new Set<string>();
  const macroTier = Math.min(cap, Math.round(cap * MACRO_TIER_SHARE));
  for (const draft of ordered) {
    if (kept.length >= macroTier) break;
    if (seen.has(draft.identity)) continue;
    seen.add(draft.identity);
    kept.push(draft);
  }

  const byAnchor = new Map<string, ComposedDraft[]>();
  for (const draft of ordered) {
    if (seen.has(draft.identity)) continue;
    const group = byAnchor.get(draft.anchorId);
    if (group) group.push(draft); else byAnchor.set(draft.anchorId, [draft]);
  }
  const anchors = [...byAnchor.keys()].sort();
  let cursor = 0;
  while (kept.length < cap && anchors.length) {
    let added = false;
    for (const anchor of anchors) {
      const group = byAnchor.get(anchor)!;
      const draft = group[cursor];
      if (!draft) continue;
      if (seen.has(draft.identity)) continue;
      seen.add(draft.identity);
      kept.push(draft);
      added = true;
      if (kept.length >= cap) break;
    }
    cursor += 1;
    if (!added) break;
  }
  return kept;
}

function partName(part: RoleOption): string {
  return part.line.ingredient.diy_name ?? part.line.ingredient.name;
}

/**
 * A composed meal is named after the two parts that identify it: the protein
 * and whichever other role the archetype actually requires. Naming by position
 * called a steak salad "Steak + Brioche" because the greens were fitted last.
 */
function headlineParts(draft: ComposedDraft): string[] {
  const template = MEAL_TEMPLATES.find((item) => item.id === draft.templateId);
  const order: MealComponentRole[] = ["protein", ...(template?.requiredRoles ?? []),
    ...(template?.optionalRoles ?? [])];
  const used = new Set<number>();
  const names: string[] = [];
  for (const role of order) {
    if (names.length >= 2) break;
    const index = draft.roles.findIndex((value, at) => value === role && !used.has(at));
    if (index < 0) continue;
    used.add(index);
    names.push(partName(draft.parts[index]));
  }
  draft.parts.forEach((part, index) => {
    if (names.length < 2 && !used.has(index)) {
      used.add(index);
      names.push(partName(part));
    }
  });
  return names;
}

/**
 * Culinary style for a composed meal: the archetype it was built from, plus the
 * kind of protein anchoring it. A protein breakfast built on smoked salmon and
 * one built on sausage are not the same breakfast, and the week should be able
 * to tell — while chicken, beef and pork collapse together, because "meat and a
 * starch" twice in a week reads as one style whichever animal it came from.
 */
const PROTEIN_STYLE_GROUP: Record<string, string> = {
  chicken: "meat", beef: "meat", pork: "meat", "breakfast-meat": "meat",
  eggs: "eggs", fish: "fish", vegetarian: "veg",
};

function composedStyle(draft: ComposedDraft): string {
  const anchor = draft.parts.find((_, index) => draft.roles[index] === "protein");
  const family = anchor ? cachedFamily(anchor.line.ingredient, "protein") : "none";
  return `${draft.templateId}:${PROTEIN_STYLE_GROUP[family] ?? family}`;
}

function materialize(drafts: ComposedDraft[]): PlannerCandidate[] {
  return drafts.map((draft) => {
    const items: DishItem[] = draft.parts.map((part) => ({
      ingredientId: part.line.ingredient.ingredient_id,
      name: part.line.ingredient.name,
      grams: part.grams,
      unitId: GRAM_UNIT_ID,
      quantity: part.grams,
    }));
    const headline = headlineParts(draft).join(" + ");
    const candidate = generatedDiyCandidate({
      id: draft.identity,
      name: `${draft.templateName}: ${headline}`,
      items,
      macros: draft.macros,
      priceIdr: draft.priceIdr,
    });
    candidate.mealArchetype = draft.templateId;
    candidate.dishStyle = composedStyle(draft);
    candidate.eligibleMealTypes = [...(MEAL_TEMPLATES.find((item) =>
      item.id === draft.templateId)?.allowedSlots ?? [])];
    return candidate;
  });
}
