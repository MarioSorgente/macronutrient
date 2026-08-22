/**
 * Derives the gram quantities Negrita's menu does not print.
 *
 * 24 of the 25 menu recipes list their components but not how much of each.
 * That leaves their macros understated by 30-90%, and leaves five dishes so far
 * below any sensible calorie target that the planner discards them outright —
 * which is why oatmeal, pancakes and waffles never appeared in a generated week.
 *
 * The quantities are recoverable rather than invented. Every recipe publishes
 * `menu_macros_per_serving` (from Negrita's own menu PDF), and every ingredient
 * it references already has verified per-100 g values. So: find the grams that
 * make the components add up to the published totals.
 *
 * The system is underdetermined — more unknown components than macros to match —
 * so it is regularised toward realistic portions, taken from the curated portion
 * units in data/enrichment/portions.json. Without that, the fit is free to hit
 * the numbers with 300 g of peanut butter and 5 g of banana.
 *
 *   node scripts/fit-menu-quantities.mjs           # report only
 *   node scripts/fit-menu-quantities.mjs --write   # write the overlay
 *
 * Writes data/enrichment/menu-quantities.json. The source database is never
 * touched; this is an overlay like every other enrichment file.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));

const database = read("data/negrita-database.json");
const addedIngredients = read("data/enrichment/added-ingredients.json");
const portionData = read("data/enrichment/portions.json");

const byId = new Map();
for (const ing of database.ingredients) byId.set(ing.ingredient_id, ing);
for (const ing of addedIngredients.ingredients ?? []) byId.set(ing.ingredient_id, ing);

/** The macros we fit against. Fiber is stated too, so it earns a constraint. */
const MACROS = ["energy_kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"];

/**
 * Scale each macro so a miss of one gram of fat counts about as much as a miss
 * of one gram of carbohydrate. Without this, calories (hundreds) would swamp
 * fiber (single digits) and the fit would ignore it entirely.
 */
const SCALE = {
  energy_kcal: 400,
  protein_g: 30,
  carbs_g: 40,
  fat_g: 20,
  fiber_g: 8,
};

/**
 * How hard to pull a quantity toward a realistic portion.
 *
 * Deliberately weak. The prior exists to break ties in an underdetermined
 * system — to prefer 100 g of banana over 5 g when both fit the macros equally
 * well — not to override the published numbers. Set too high it simply refuses
 * to reach the target at all.
 */
const PRIOR_WEIGHT = 0.05;

/**
 * A plausible starting portion for an ingredient.
 *
 * Prefers the curated portion unit — "1 banana", "1 slice", "1 tbsp" — because
 * that is a real serving someone measured. Falls back to a modest default so a
 * garnish does not start life as a main course.
 */
function priorGrams(ingredient) {
  const overlay = portionData.ingredients?.[ingredient.ingredient_id];
  const units = overlay?.units ?? [];
  const preferredId = overlay?.defaultUnitId ?? ingredient.defaultUnitId;

  const preferred = units.find((u) => u.id === preferredId && u.id !== "g");
  if (preferred?.gramWeight) return preferred.gramWeight;

  const anyUnit = units.find((u) => u.id !== "g" && u.gramWeight);
  if (anyUnit) return anyUnit.gramWeight;

  // No curated portion: guess from how calorie-dense it is. Oils and nut
  // butters go in by the spoon; vegetables and dairy by the handful or cup.
  const kcal = ingredient.macros_per_100g?.energy_kcal ?? 100;
  if (kcal >= 500) return 20;
  if (kcal >= 250) return 60;
  if (kcal >= 100) return 100;
  return 80;
}

/**
 * Bounds keep the fit inside portions a kitchen would recognise, but generously.
 *
 * Tight bounds are worse than none: when the reachable maximum falls short of
 * the published calories the solver silently returns its best infeasible guess,
 * which is how an 1,100 kcal oatmeal bowl first came back as 486.
 */
function boundsFor(prior) {
  // Wide enough that a dish can reach its published macros, capped so a
  // condiment cannot quietly become the main event.
  return { min: Math.max(3, prior * 0.2), max: Math.min(prior * 8, 400) };
}

/**
 * Bounded least squares by coordinate descent.
 *
 * Each quantity in turn is set to its exact minimising value with the others
 * held fixed — the objective is quadratic in one variable, so that is a closed
 * form rather than a step size to tune. Converges in a handful of sweeps and,
 * unlike the gradient version this replaced, has nothing to get wrong.
 */
function solve(unknowns, need) {
  const raw = unknowns.map((u) => priorGrams(u));

  /**
   * Scale every prior so they collectively land near the calories we need
   * before fitting starts.
   *
   * A curated portion is "one serving of this thing on its own", but a combo
   * plate has a dozen components sharing one serving's worth of food. Left
   * unscaled, twelve full portions overshoot badly and the solver spends its
   * freedom pulling them back rather than balancing the macros. Scaling keeps
   * the *relative* sizes the curated data encodes — which is the part worth
   * trusting — while matching the magnitude.
   */
  const priorKcal = unknowns.reduce(
    (sum, u, i) => sum + ((u.macros_per_100g?.energy_kcal ?? 0) * raw[i]) / 100,
    0
  );
  const scale =
    priorKcal > 0 && need.energy_kcal > 0
      ? Math.min(4, Math.max(0.15, need.energy_kcal / priorKcal))
      : 1;

  const priors = raw.map((g) => g * scale);
  const bounds = priors.map(boundsFor);
  const x = priors.slice();

  // Per-gram macro contribution of each unknown ingredient.
  const A = unknowns.map((u) =>
    MACROS.map((m) => (u.macros_per_100g?.[m] ?? 0) / 100)
  );
  const w = MACROS.map((m) => 1 / (SCALE[m] * SCALE[m]));
  const target = MACROS.map((m) => need[m]);

  for (let sweep = 0; sweep < 500; sweep += 1) {
    let moved = 0;

    for (let j = 0; j < x.length; j += 1) {
      // What every other ingredient already contributes to each macro.
      const rest = MACROS.map((_, mi) =>
        x.reduce((sum, xi, i) => (i === j ? sum : sum + xi * A[i][mi]), 0)
      );

      // The pull toward the prior is scaled by this ingredient's macro
      // leverage, so it stays a tie-breaker for everything. Penalising
      // ((x-p)/p)^2 directly made the term blow up as p got small, which
      // pinned exactly the ingredients a dish leans on for fat — the oils and
      // sauces that come in tablespoons — and left combo plates fat-short.
      let leverage = 0;
      MACROS.forEach((_, mi) => {
        leverage += w[mi] * A[j][mi] * A[j][mi];
      });
      const pull = PRIOR_WEIGHT * leverage;

      let numerator = pull * priors[j];
      let denominator = pull;
      MACROS.forEach((_, mi) => {
        numerator += w[mi] * A[j][mi] * (target[mi] - rest[mi]);
        denominator += w[mi] * A[j][mi] * A[j][mi];
      });

      const exact = denominator > 0 ? numerator / denominator : priors[j];
      const next = Math.min(bounds[j].max, Math.max(bounds[j].min, exact));
      moved = Math.max(moved, Math.abs(next - x[j]));
      x[j] = next;
    }

    if (moved < 1e-6) break;
  }

  return x.map((v, i) => roundPortion(v, unknowns[i]));
}

/** Kitchens work in round numbers, not in 73.418 g. */
function roundPortion(grams, ingredient) {
  const integerOnly = (portionData.ingredients?.[ingredient.ingredient_id]?.units ?? [])
    .some((u) => u.integerOnly && u.id !== "g");
  if (integerOnly) {
    // Countable things come in whole units — two eggs, one slice — so round to
    // a multiple of the unit weight, then to a tenth so the stored number is
    // not 21.599999999999998.
    const prior = priorGrams(ingredient);
    const whole = Math.max(1, Math.round(grams / prior)) * prior;
    return Math.round(whole * 10) / 10;
  }
  if (grams >= 100) return Math.round(grams / 10) * 10;
  if (grams >= 20) return Math.round(grams / 5) * 5;
  return Math.max(5, Math.round(grams));
}

function macrosOf(ingredientId, grams) {
  const ing = byId.get(ingredientId);
  const out = {};
  for (const m of MACROS) {
    out[m] = ((ing?.macros_per_100g?.[m] ?? 0) * grams) / 100;
  }
  return out;
}

const results = [];

for (const recipe of database.menu_recipes) {
  const stated = recipe.menu_macros_per_serving;
  const unknownComponents = recipe.components.filter((c) => c.quantity_g == null);
  if (unknownComponents.length === 0) continue;
  if (!stated || typeof stated.energy_kcal !== "number") continue;

  // What the stated components already account for.
  const known = Object.fromEntries(MACROS.map((m) => [m, 0]));
  for (const c of recipe.components) {
    if (c.quantity_g == null) continue;
    const part = macrosOf(c.ingredient_id, c.quantity_g);
    for (const m of MACROS) known[m] += part[m];
  }

  // What the unknown components have to supply.
  const need = Object.fromEntries(
    MACROS.map((m) => [m, Math.max(0, (stated[m] ?? 0) - known[m])])
  );

  const unknowns = unknownComponents
    .map((c) => byId.get(c.ingredient_id))
    .filter(Boolean);
  if (unknowns.length !== unknownComponents.length) {
    console.warn(`! ${recipe.name}: some components are not in the database`);
    continue;
  }

  const grams = solve(unknowns, need);

  const fitted = Object.fromEntries(MACROS.map((m) => [m, known[m]]));
  unknowns.forEach((u, i) => {
    const part = macrosOf(u.ingredient_id, grams[i]);
    for (const m of MACROS) fitted[m] += part[m];
  });

  /**
   * Fit quality is judged on the four macros people actually plan against.
   *
   * Fiber is fitted but not scored: menus round it heavily, and a 3 g miss on a
   * 4 g stated value reads as 75% while meaning nothing. Misses are also
   * ignored below a few grams for the same reason — a percentage of a small
   * number is not a useful signal.
   */
  const SCORED = ["energy_kcal", "protein_g", "carbs_g", "fat_g"];
  const FLOOR = { energy_kcal: 40, protein_g: 5, carbs_g: 6, fat_g: 4 };

  const worst = SCORED.reduce(
    (acc, m) => {
      const target = stated[m] ?? 0;
      const delta = Math.abs(fitted[m] - target);
      if (target <= 0 || delta < FLOOR[m]) return acc;
      const pct = delta / target;
      return pct > acc.pct ? { macro: m, pct } : acc;
    },
    { macro: "energy_kcal", pct: 0 }
  );

  results.push({
    recipe_id: recipe.recipe_id,
    name: recipe.name,
    quantities: Object.fromEntries(
      unknowns.map((u, i) => [u.ingredient_id, grams[i]])
    ),
    fitted: Object.fromEntries(MACROS.map((m) => [m, Math.round(fitted[m])])),
    stated: Object.fromEntries(MACROS.map((m) => [m, stated[m] ?? 0])),
    worst_macro: worst.macro,
    worst_pct: Math.round(worst.pct * 100),
  });
}

// --- report -----------------------------------------------------------------

const pad = (v, n) => String(v).padEnd(n);
const num = (v, n) => String(v).padStart(n);

console.log(
  `${pad("dish", 44)}${num("kcal fit", 9)}${num("menu", 7)}${num("P", 6)}${num("menu", 6)}${num("C", 6)}${num("menu", 6)}${num("F", 6)}${num("menu", 6)}${num("worst", 8)}`
);
for (const r of results) {
  console.log(
    pad(r.name.slice(0, 43), 44) +
      num(r.fitted.energy_kcal, 9) +
      num(r.stated.energy_kcal, 7) +
      num(Math.round(r.fitted.protein_g), 6) +
      num(r.stated.protein_g, 6) +
      num(Math.round(r.fitted.carbs_g), 6) +
      num(r.stated.carbs_g, 6) +
      num(Math.round(r.fitted.fat_g), 6) +
      num(r.stated.fat_g, 6) +
      num(`${r.worst_pct}%`, 8)
  );
}

console.log("\n--- fitted quantities ---");
for (const r of results) {
  console.log(`\n${r.name}`);
  for (const [id, grams] of Object.entries(r.quantities)) {
    console.log(`   ${num(grams, 6)} g  ${id}`);
  }
}

const poor = results.filter((r) => r.worst_pct > 15);
console.log(
  `\n${results.length} recipes fitted · ${poor.length} with a worst-macro miss above 15%`
);
for (const r of poor) {
  console.log(`   ${r.name} — ${r.worst_macro} off by ${r.worst_pct}%`);
}

// --- write ------------------------------------------------------------------

if (process.argv.includes("--write")) {
  const out = {
    "//": "Gram quantities derived by fitting each recipe's components to the macros Negrita's own menu publishes. Generated by scripts/fit-menu-quantities.mjs — do not edit by hand; correct the source recipe or the script instead.",
    provenance: "derived_from_menu_macros",
    generated_at: new Date().toISOString().slice(0, 10),
    recipes: Object.fromEntries(
      results.map((r) => [
        r.recipe_id,
        {
          name: r.name,
          quantities: r.quantities,
          fit: { worst_macro: r.worst_macro, worst_pct: r.worst_pct },
        },
      ])
    ),
  };
  const target = fileURLToPath(new URL("data/enrichment/menu-quantities.json", root));
  writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${target}`);
} else {
  console.log("\n(report only — pass --write to save the overlay)");
}
