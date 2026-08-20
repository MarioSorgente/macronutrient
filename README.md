# Mamma Calories — For Negrita

A simple, restaurant-focused macro builder (think MyFitnessPal, but simpler and
for a kitchen). Pick ingredients from Negrita's nutrition database, set the grams
for each, combine them into a **dish**, watch the macros add up, **save** the
dish, and generate a **printable report**.

Built with **Next.js (App Router) + TypeScript + Tailwind CSS**, deployed on
**Vercel**.

---

## What it does

- **Ingredient picker** — search 91 ingredients by name, category, or menu
  wording. Token search ("chick br" finds *Chicken breast*), match highlighting,
  category icons, sorting, recently-used shortcuts, and keyboard flow
  (`/` to search, ↑/↓ to move, Enter to add).
- **Real portions** — count ingredients the way a kitchen does: *2 large eggs*,
  *1 pita*, *1 tbsp oil*. Countable units accept whole numbers only; grams stay
  authoritative underneath and are always shown.
- **Dish builder** — totals (calories, protein, carbs, fat, fiber) and the
  protein/carb/fat energy split update live.
- **Menu templates** — load any of Negrita's 25 menu dishes as an editable
  starting point (quantities not printed on the menu load as 0 to fill in).
- **Clients** — plan a client's meals across up to **6 weeks**, with editable
  meal slots, optional daily macro targets, adherence bars, and a printable
  per-week or whole-program report.
- **House items** — define a Negrita sauce/blend/bake from its own batch recipe
  and finished weight; the computed values replace the shipped estimate
  everywhere in the app.
- **Reports** — clean, print-optimized pages you can Print or Save as PDF.

Macros follow the database's own rule: `grams ÷ 100 × value per 100 g`, summed
across ingredients.

## About the data

`data/negrita-database.json` is Negrita's provenance record and is **never
mutated**. Enrichment lives in `data/enrichment/` and is merged at load, so every
addition stays auditable.

The database was checked against live USDA FoodData Central
(`node scripts/enrich-from-usda.mjs`): **all 91 ingredients' macros verified with
zero discrepancies**. What was genuinely missing was portion data — now curated
into `data/enrichment/portions.json` (135 units across 85 ingredients) by
`scripts/build-portions.mjs`.

Eight house items (chimichurri, syrniki, banana bread, Island sauce, peri-peri,
shio kombu, and two spice blends) have no public equivalent, so their values are
estimates flagged **est** in the UI. Entering their real recipe on the
**House items** page makes them exact.

---

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. No environment variables are required to run.

Other scripts:

```bash
npm run build      # production build
npm run typecheck  # TypeScript check, no emit
```

---

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel, **Add New → Project** and import the repo.
3. Framework is auto-detected as **Next.js** (build `next build`). Nothing to
   configure.
4. **Deploy.** That's it — the app runs with zero environment variables.

---

## Storage

Saved dishes, clients, and house recipes all use one small `Repository<T>`
interface with two interchangeable backends:

- **`local`** (default) — the browser's `localStorage`. Zero setup; dishes live
  on the device that created them.
- **`firebase`** — Cloud Firestore, so dishes are shared across devices/staff.
  Prepared and ready, but dormant until you configure it.

Switching backends changes no UI or logic — only environment variables.

### Turning on Firebase (later)

1. Create a project at <https://console.firebase.google.com>.
2. Enable **Firestore Database**.
3. Add a **Web app** and copy its SDK config.
4. Set these in **Vercel → Project → Settings → Environment Variables** (and in
   a local `.env.local`, copied from `.env.local.example`):

   ```
   NEXT_PUBLIC_STORAGE_BACKEND=firebase
   NEXT_PUBLIC_FIREBASE_API_KEY=…
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=…
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=…
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=…
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=…
   NEXT_PUBLIC_FIREBASE_APP_ID=…
   ```

5. Redeploy.

> **Security note:** the app is currently an open link with no login. If you
> enable Firestore, its default rules would let anyone read/write. Before going
> live with Firebase, either lock the Firestore security rules down or add
> authentication. This matters more now that **client names and plans** are
> stored: that is personal data. Collections used: `dishes`, `clients`,
> `houseRecipes` — one document per record.

---

## Project structure

```
data/negrita-database.json      Bundled nutrition database (never mutated)
data/enrichment/portions.json   Curated portion units merged at load
scripts/enrich-from-usda.mjs    Dev tool: refresh portions + verify vs USDA
scripts/build-portions.mjs      Dev tool: curate raw USDA portions
src/types/nutrition.ts          Ingredient / MenuRecipe / Macros / PortionUnit
src/lib/database.ts             Load, merge overlays, index + search
src/lib/calc.ts                 Macro calculation helpers
src/lib/units.ts                Grams <-> portion unit conversion
src/lib/clients.ts              Weekly plan totals, averages, adherence
src/lib/storage/                Repository: local (now) + firebase (prepared)
src/store/                      Dish-builder + house-recipe state (Zustand)
src/components/                 UI (picker, builder, planner, reports, …)
src/app/                        Routes: /, /dishes, /report/[id], /clients,
                                /clients/[id], /clients/[id]/report, /house-items
```

---

## Refreshing the data (optional, rare)

```bash
node scripts/enrich-from-usda.mjs
node scripts/build-portions.mjs
```

The first re-checks every USDA-linked ingredient and writes review files to
`data/enrichment/` (including `accuracy-report.json`); the second rebuilds the
curated unit list. Corrections are applied after review — the scripts never
silently overwrite the source database.

## Not included yet (easy future additions)

Extra nutrient fields (saturated fat, sugars, sodium — deliberately out of scope),
ingredient/dish cost in IDR, and per-serving splitting on the dish builder. The
data to support these is largely available already.
