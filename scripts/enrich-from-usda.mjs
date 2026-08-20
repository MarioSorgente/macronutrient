/**
 * Pulls portion weights and current nutrient values from USDA FoodData Central
 * for every ingredient that carries an fdc_id.
 *
 * Run manually — this is a dev-time tool, not part of the build:
 *   node scripts/enrich-from-usda.mjs
 *
 * Uses FDC_API_KEY if set (free key: https://fdc.nal.usda.gov/api-key-signup.html),
 * otherwise falls back to DEMO_KEY, which is rate limited but sufficient here
 * because foods are fetched 20 at a time.
 *
 * Writes two review artifacts into data/enrichment/:
 *   usda-portions.raw.json  — every foodPortion USDA knows about
 *   accuracy-report.json    — current DB value vs live USDA value, with diffs
 *
 * It deliberately does NOT overwrite the source database. Corrections are
 * applied by hand into data/enrichment/corrections.json after review.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "data", "negrita-database.json");
const OUT_DIR = path.join(ROOT, "data", "enrichment");

const API_KEY = process.env.FDC_API_KEY || "DEMO_KEY";
const BATCH_SIZE = 20;

/** FDC nutrient numbers for the five macros the app tracks. */
const NUTRIENT_NUMBERS = {
  energy_kcal: "208",
  protein_g: "203",
  carbs_g: "205",
  fat_g: "204",
  fiber_g: "291",
};

/** Relative difference above which a value is worth a human look. */
const DIFF_THRESHOLD = 0.05;

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Energy can appear as both kcal and kJ; prefer the kcal record. */
function readNutrient(food, number) {
  const matches = (food.foodNutrients ?? []).filter(
    (n) => String(n.nutrient?.number) === number
  );
  if (!matches.length) return null;
  const kcal = matches.find((n) => n.nutrient?.unitName?.toUpperCase() === "KCAL");
  const chosen = kcal ?? matches[0];
  return typeof chosen.amount === "number" ? chosen.amount : null;
}

async function fetchBatch(ids) {
  const params = ids.map((id) => `fdcIds=${id}`).join("&");
  const url = `https://api.nal.usda.gov/fdc/v1/foods?${params}&api_key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`USDA request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function main() {
  const db = JSON.parse(await readFile(SOURCE, "utf8"));
  const linked = db.ingredients.filter((i) => i.source?.fdc_id);
  const unlinked = db.ingredients.filter((i) => !i.source?.fdc_id);

  console.log(
    `${linked.length} ingredients have an fdc_id; ${unlinked.length} do not ` +
      `(house items — only Negrita's recipes can resolve those).`
  );

  const byFdcId = new Map();
  for (const ing of linked) {
    const list = byFdcId.get(ing.source.fdc_id) ?? [];
    list.push(ing);
    byFdcId.set(ing.source.fdc_id, list);
  }

  const ids = [...byFdcId.keys()];
  const batches = chunk(ids, BATCH_SIZE);
  const foods = [];

  for (const [index, batch] of batches.entries()) {
    console.log(`Fetching batch ${index + 1}/${batches.length} (${batch.length} foods)…`);
    foods.push(...(await fetchBatch(batch)));
  }

  const portions = {};
  const accuracy = [];

  for (const food of foods) {
    const matched = byFdcId.get(food.fdcId) ?? [];

    const foodPortions = (food.foodPortions ?? [])
      .map((p) => {
        const label = [p.modifier, p.measureUnit?.name]
          .filter((v) => v && v !== "undetermined")
          .join(" ")
          .trim();
        return {
          label: p.portionDescription || label || "portion",
          gramWeight: p.gramWeight,
          amount: p.amount ?? 1,
        };
      })
      .filter((p) => typeof p.gramWeight === "number" && p.gramWeight > 0);

    for (const ing of matched) {
      if (foodPortions.length) {
        portions[ing.ingredient_id] = {
          fdc_id: food.fdcId,
          usda_description: food.description,
          portions: foodPortions,
        };
      }

      const row = {
        ingredient_id: ing.ingredient_id,
        name: ing.name,
        fdc_id: food.fdcId,
        usda_description: food.description,
        fields: {},
      };

      for (const [key, number] of Object.entries(NUTRIENT_NUMBERS)) {
        const usda = readNutrient(food, number);
        const current = ing.macros_per_100g[key];
        if (usda === null) {
          row.fields[key] = { current, usda: null, note: "not reported by USDA" };
          continue;
        }
        const diff = usda - current;
        const rel = current === 0 ? (usda === 0 ? 0 : 1) : Math.abs(diff) / current;
        row.fields[key] = {
          current,
          usda: Number(usda.toFixed(3)),
          diff: Number(diff.toFixed(3)),
          flagged: rel > DIFF_THRESHOLD && Math.abs(diff) > 0.2,
        };
      }

      row.hasFlagged = Object.values(row.fields).some((f) => f.flagged);
      accuracy.push(row);
    }
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    path.join(OUT_DIR, "usda-portions.raw.json"),
    JSON.stringify(portions, null, 2)
  );
  await writeFile(
    path.join(OUT_DIR, "accuracy-report.json"),
    JSON.stringify(
      {
        generated_on: new Date().toISOString().slice(0, 10),
        threshold: DIFF_THRESHOLD,
        ingredients_checked: accuracy.length,
        ingredients_with_flagged_fields: accuracy.filter((r) => r.hasFlagged).length,
        unlinked_ingredients: unlinked.map((i) => i.ingredient_id),
        rows: accuracy,
      },
      null,
      2
    )
  );

  const withPortions = Object.keys(portions).length;
  const flagged = accuracy.filter((r) => r.hasFlagged).length;
  console.log(`\nPortion data found for ${withPortions} ingredients.`);
  console.log(`${flagged} ingredients have at least one flagged macro difference.`);
  console.log(`Wrote review files to data/enrichment/.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
