/**
 * Turns the raw USDA portion dump into the curated unit list the app ships.
 *
 *   node scripts/build-portions.mjs
 *
 * Reads  data/enrichment/usda-portions.raw.json
 * Writes data/enrichment/portions.json
 *
 * USDA portion descriptions are regulatory rather than practical ("RACC",
 * "1 oz", 'pita, large (6-1/2" dia)'). This script filters them to units a
 * kitchen actually uses, tidies the labels, marks countable units so the UI can
 * force whole numbers, and layers on hand-curated units for ingredients USDA
 * has no portion data for.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "data", "enrichment", "usda-portions.raw.json");
const OUT = path.join(ROOT, "data", "enrichment", "portions.json");

/** Imperial weights and vague measures a kitchen can't act on. */
const DROP = [/^oz$/, /^fl oz$/, /^dash$/, /^packet/, /^bottle$/, /^nlea serving$/];

/** Words that mean "you can count these", so the input must be a whole number. */
const COUNTABLE =
  /\b(large|small|medium|piece|slice|pita|tortilla|roll|ear|stalk|spear|date|fruit|pancake|waffle|onion|scallop|olive|almond|egg)\b/;

/** Tidy USDA wording into something readable in a dropdown. */
const RELABEL = [
  [/^racc$/, "serving"],
  [/^nlea serving$/, "serving"],
  [/^tablespoon$/, "tbsp"],
  [/^liquid oil tablespoon$/, "tbsp"],
  [/^cup, chopped$/, "cup chopped"],
  [/^tbsp, chopped$/, "tbsp chopped"],
  [/^roll 1 serving$/, "roll"],
  [/^date, pitted$/, "date"],
  [/^edible onion$/, "onion"],
  [/^serving \(2 tbsp\)$/, "serving (2 tbsp)"],
];

/**
 * Units for ingredients USDA gives no portions for, plus a few obvious ones it
 * omits. Weights are standard reference values, marked source "curated" so they
 * are distinguishable from USDA-sourced portions in the app.
 */
const CURATED = {
  banana_raw: [{ label: "medium banana", gramWeight: 118, integerOnly: true }],
  cheese_american: [{ label: "slice", gramWeight: 21, integerOnly: true }],
  cheese_cottage_lowfat: [{ label: "cup", gramWeight: 226 }],
  greek_yogurt_nonfat: [
    { label: "cup", gramWeight: 245 },
    { label: "tbsp", gramWeight: 15 },
  ],
  milk_whole: [
    { label: "cup", gramWeight: 244 },
    { label: "tbsp", gramWeight: 15 },
  ],
  hummus: [{ label: "tbsp", gramWeight: 15 }],
  mustard_yellow: [
    { label: "tsp", gramWeight: 5 },
    { label: "tbsp", gramWeight: 15 },
  ],
  peanut_butter_creamy: [{ label: "tbsp", gramWeight: 16 }],
  nuts_almonds_roasted: [{ label: "almond", gramWeight: 1.2, integerOnly: true }],
  kalamata_olives_proxy: [{ label: "olive", gramWeight: 4, integerOnly: true }],
  halkidiki_olives_proxy: [{ label: "olive", gramWeight: 4, integerOnly: true }],
  scallops_sea_raw: [{ label: "scallop", gramWeight: 30, integerOnly: true }],
  tomato_cherry_raw: [{ label: "cherry tomato", gramWeight: 17, integerOnly: true }],
  jalapeno_raw: [{ label: "pepper", gramWeight: 14, integerOnly: true }],
  chili_raw_proxy: [{ label: "chili", gramWeight: 6, integerOnly: true }],
  pickles_cucumber_dill: [
    { label: "spear", gramWeight: 30, integerOnly: true },
    { label: "slice", gramWeight: 6, integerOnly: true },
  ],
  // Sauces are measured by spoon in service; a tbsp is ~15 g regardless of the
  // recipe behind it, so this stays valid even before house recipes are entered.
  chimichurri_negrita: [{ label: "tbsp", gramWeight: 15 }],
  peri_peri_sauce_negrita: [{ label: "tbsp", gramWeight: 15 }],
  negrita_island_sauce: [{ label: "tbsp", gramWeight: 15 }],
  tzatziki_proxy: [{ label: "tbsp", gramWeight: 15 }],
  shio_kombu_marinade_negrita: [{ label: "tbsp", gramWeight: 15 }],
  spicy_mayo_proxy: [{ label: "tbsp", gramWeight: 14 }],
  whey_protein_isolate: [{ label: "scoop", gramWeight: 30, integerOnly: true }],
};

/** Ingredients that should open on a count unit rather than grams. */
const DEFAULT_UNIT_HINT = [
  /^egg_/,
  /^pita_bread/,
  /^tortilla_/,
  /^toast_/,
  /^potato_bun/,
  /^paratha_/,
  /^banana_raw$/,
];

function slug(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

function tidy(label) {
  let out = label.trim().replace(/\s+/g, " ").toLowerCase();
  for (const [pattern, replacement] of RELABEL) {
    if (pattern.test(out)) return replacement;
  }
  return out;
}

async function main() {
  const raw = JSON.parse(await readFile(RAW, "utf8"));
  const result = {};

  // 1. USDA-derived units.
  for (const [ingredientId, record] of Object.entries(raw)) {
    const units = [];
    const seen = new Set();

    for (const portion of record.portions) {
      const label = tidy(portion.label);
      if (DROP.some((p) => p.test(label))) continue;

      const amount = portion.amount || 1;
      const gramWeight = Number((portion.gramWeight / amount).toFixed(2));
      if (!Number.isFinite(gramWeight) || gramWeight <= 0) continue;

      const id = slug(label);
      if (!id || seen.has(id)) continue;
      seen.add(id);

      units.push({
        id,
        label,
        gramWeight,
        ...(COUNTABLE.test(label) ? { integerOnly: true } : {}),
        source: "usda",
      });
    }

    if (units.length) result[ingredientId] = { units };
  }

  // 2. Curated additions.
  for (const [ingredientId, units] of Object.entries(CURATED)) {
    const entry = (result[ingredientId] ??= { units: [] });
    for (const unit of units) {
      const id = slug(unit.label);
      if (entry.units.some((u) => u.id === id)) continue;
      entry.units.push({ ...unit, id, source: "curated" });
    }
  }

  // 3. Pick a sensible default unit per ingredient.
  for (const [ingredientId, entry] of Object.entries(result)) {
    entry.units.sort((a, b) => a.gramWeight - b.gramWeight);
    const wantsCount = DEFAULT_UNIT_HINT.some((p) => p.test(ingredientId));
    if (!wantsCount) continue;
    const countable = entry.units.filter((u) => u.integerOnly);
    // Prefer the "large"/standard size over the smallest one USDA happens to list.
    const preferred =
      countable.find((u) => /\blarge\b/.test(u.label)) ??
      countable.find((u) => /\bmedium\b/.test(u.label)) ??
      countable[0];
    if (preferred) entry.defaultUnitId = preferred.id;
  }

  await writeFile(
    OUT,
    JSON.stringify(
      {
        generated_on: new Date().toISOString().slice(0, 10),
        note:
          "Curated from USDA foodPortions plus hand-added standard weights. " +
          "Grams remain authoritative for all macro math; units are input helpers.",
        ingredients: result,
      },
      null,
      2
    )
  );

  const total = Object.values(result).reduce((n, e) => n + e.units.length, 0);
  console.log(
    `Wrote ${total} units across ${Object.keys(result).length} ingredients to data/enrichment/portions.json`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
