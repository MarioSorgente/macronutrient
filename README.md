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
- **For coaches** — the same client screen in **Coach mode**: set daily macro
  targets and the planner auto-fills the week from what Negrita actually sells,
  showing **cost per meal, per day and per week**. Review and shuffle before
  anything is saved.
- **Prices** — every DIY menu component carries its price, so dishes, plans and
  reports show what the food costs.
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

The original 91 ingredients were checked against live USDA FoodData Central
(`node scripts/enrich-from-usda.mjs`): **all macros verified with zero
discrepancies**. Portion data was missing entirely and is now curated into
`data/enrichment/portions.json` by `scripts/build-portions.mjs`.

**Negrita's DIY menu** (`data/enrichment/diy-menu.json`) adds 49 orderable
components with portion sizes and prices. It brought **25 ingredients that were
missing from the database**, held in `data/enrichment/added-ingredients.json`
with strict provenance:

| Provenance | Count | Meaning |
|---|---|---|
| `verified_usda` | 8 | Real `fdc_id`, values retrieved from USDA |
| `menu_stated` | 13 | Derived from the menu's printed macros — no USDA record verified |
| house preparations | 4 | Negrita's own recipes; editable on the House items page |

Where the DIY menu and USDA disagree for an ingredient in both, **USDA wins** —
the source database is never overwritten; the menu contributes prices and
portions only.

Several menu-derived values land on well-known reference figures, which is good
corroboration: cheddar 403 kcal/100 g (reference 403), feta 263 (264),
watermelon 30 (30), beetroot 45 (44).

> **Menu correction found:** Spanish Anchovy is printed as 30 g with **10 g
> carbs**. Anchovies have none, and the menu's own 90 kcal only reconciles at
> 0 C (4/4/9 gives 91; with 10 C it gives 131). The app records 0 C — worth
> fixing on the printed menu.

House items (chimichurri, syrniki, banana bread, the sauces and spice blends,
plus the four DIY chicken/butter preparations) have no public equivalent, so
their values are estimates flagged **est** in the UI. Entering their real recipe
on the **House items** page makes them exact.

## Pricing

DIY prices are printed in thousands of rupiah (65 = Rp 65,000) and stored as full
rupiah. Cost is counted in **whole portions**, because that is what the kitchen
sells: 100 g taken from a 200 g rice portion still costs one portion.

Anything not on the DIY menu has no price. The app then shows `from Rp …` or `—`
rather than a total that silently omits ingredients.

## Coach mode

`Clients` and `For coaches` are **the same screen in two modes**, over one client
record — there is no second roster, plan or report to keep in sync. The nav link
just lands in coach mode.

The generator (`src/lib/mealPlanner.ts`) runs in two steps: **what the client
likes**, then **the plan**. It builds each meal from composed DIY combinations
(protein + carb + veg + fat, in whole portions), Negrita menu dishes, and your
own saved/custom dishes — each source toggled separately. It weights **protein at
2×** since that is what a coach holds a client to, applies a mild cost preference,
and keeps snacks smaller than main meals.

**Preferences** are remembered per client:

- **Macro style** (high protein / balanced / low carb / high carb) turns a
  calorie figure into gram targets, which stay editable.
- **Protein lean** — "more fish", "more beef" — is a *bias, not a filter*.
  Everything stays eligible, so no slot goes unfilled because of a preference;
  leaned proteins also tolerate more repetition, since asking for more fish means
  expecting to see it more often.
- **Avoid list** is the one hard rule: those ingredients appear in no meal.

**Variety** is enforced, not hoped for: the same meal can never appear twice in a
day, and repeats across the week are penalised in tiers — the exact meal hardest,
then the protein, then the carbohydrate, so a single rice or potato can't quietly
run all seven days.

> Note on leanings: Negrita's DIY menu has only **two fish items large enough to
> anchor a meal** against nine meat ones, so "more fish" shifts the week as far as
> the menu allows rather than dominating it.

It deliberately refuses to fake a plan: a protein must be a real portion to
anchor a meal (tobiko and a single ham slice are garnishes, not dinner), and if
no sensible meal fits the constraints the slot is **left empty and reported**
rather than padded with something wildly off target.

## Plan views

The planner has a **Day / Week** switch. Week is the seven-column overview; Day
shows one day full width, where meal names have room to be read rather than
truncated. It opens on Week for desktop and Day on mobile, and remembers an
explicit choice.

Any meal is **clickable**: the dialog shows its macros, price and the full
ingredient breakdown with each ingredient's contribution, and is where servings,
price and removal are edited. The price shown is the **total**, so it moves as
servings change.

Adding a meal offers two tabs: pick a **saved** dish, or **build** one on the
spot from Negrita's ingredients — with the same portion units as the main builder
("2 large eggs"), live macros and cost. Built meals go into the plan inline, with
an optional "also save to my dishes".

**Prices can be raised, never lowered.** The calculated menu price is a hard
floor; typing a lower figure snaps the field back to it rather than silently
discarding it. Mark-ups are stored per serving, so they stay correct when
servings change, and marked-up meals carry an arrow so a raised price is never
invisible in the totals it feeds. A `Hide prices` control clears cost out of the
planner when you are just arranging meals.

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
data/negrita-database.json           Bundled nutrition database (never mutated)
data/enrichment/portions.json        Curated portion units merged at load
data/enrichment/diy-menu.json        DIY components: portions + prices
data/enrichment/added-ingredients.json  25 ingredients the database lacked
scripts/enrich-from-usda.mjs         Dev tool: refresh portions + verify vs USDA
scripts/build-portions.mjs           Dev tool: curate raw USDA portions
src/types/nutrition.ts               Ingredient / Macros / PortionUnit / DiyMenuItem
src/lib/database.ts                  Load, merge overlays, index + search
src/lib/calc.ts                      Macro calculation helpers
src/lib/units.ts                     Grams <-> portion unit conversion
src/lib/pricing.ts                   Whole-portion costing in IDR
src/lib/mealPlanner.ts               Coach auto-planner
src/lib/clients.ts                   Plan totals, averages, adherence, cost
src/lib/coachMode.ts                 Manual/Coach mode state
src/lib/planView.ts                  Day/Week view + show-prices state
src/lib/storage/                     Repository: local (now) + firebase (prepared)
src/store/                           Dish-builder + house-recipe state (Zustand)
src/components/                      UI (picker, builder, planner, reports, …)
src/app/                             Routes: /, /dishes, /report/[id], /clients,
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
