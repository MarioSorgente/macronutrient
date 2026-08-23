# Mamma Calories — For Negrita

Plan a week of real food from Negrita's menu, see exactly what it delivers, and
send it to the kitchen to prepare. Diners plan on verified macros; the kitchen
works from a day-by-day prep board; the owner sees signups, usage and revenue.

Built with **Next.js (App Router) + TypeScript + Tailwind CSS** on **Vercel**,
with **Firebase** for accounts, data and the server-side order pipeline.

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
- **Weekly planner** — plan meals across up to **6 weeks**, with editable meal
  slots, optional daily macro targets, adherence bars, and a printable per-week
  or whole-program report.
- **Auto-fill** — set daily macro targets and the planner assembles a week from
  what Negrita actually sells, showing **cost per meal, per day and per week**.
  Review and shuffle before anything is saved.
- **Send it to the kitchen** — submit a week as a prep order, choosing pickup or
  delivery for each day. The kitchen gets a day-by-day board; you get a receipt.
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

## Auto-fill a week

There is no coach role and no client roster: a person plans their own week, and
everything they do lives under one **Plan & Build** destination.

The generator (`src/lib/mealPlanner.ts`) runs in two steps: **what the client
likes**, then **the plan**. It builds each meal from composed DIY combinations
(protein + carb + veg + fat, in whole portions), Negrita menu dishes, and your
own saved/custom dishes — each source toggled separately. It weights **protein at
2×** since that is what people hold themselves to, applies a mild cost preference,
and keeps snacks smaller than main meals.

**Preferences** are remembered with the plan:

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
npm run lint       # ESLint
```

---

## Tests

```bash
npm test               # unit — pure logic, no services, a few seconds
npm run test:emulated  # rules, indexes and Cloud Functions, on the emulators
npm run e2e            # end-to-end in a real browser, desktop + phone
npm run bench          # hot-path timings (not part of CI — machine dependent)
```

`test:emulated` and `e2e` start the Firebase emulator suite themselves and shut
it down afterwards; both need Java on the PATH. No credentials or setup are
needed — the emulators require none, and the owner allowlist the tests use is
configured in `vitest.config.ts` and `playwright.config.ts`.

The end-to-end suite runs against a production build rather than `next dev`,
because the dev server compiles routes on first request and that made the long
journeys flaky. It also means the tests exercise the bundle that ships.

Everything above runs on every push via `.github/workflows/ci.yml`.

---

## Accounts and roles

Planning works with no account at all — a guest's week lives in `localStorage`
on their device. Signing in is required only to **send a week to the kitchen**,
and at that moment the device's work is copied into the account.

Three roles, held as **Firebase Auth custom claims** rather than in a document,
because a document is something a user could try to write:

| Role | Can |
|---|---|
| `client` | Plan, build dishes, submit weeks, see their own orders |
| `restaurant` | All of the above, plus the kitchen board and the order book |
| `admin` | All of the above, plus revenue, customers and settings |

The first admin is bootstrapped from an `ADMIN_EMAILS` allowlist held in Secret
Manager; after that, roles are granted from **Admin → Settings**.

**If you are the owner and the app says your role is `none`**, your account was
created before the functions were deployed, or before the allowlist contained
your address. The sign-up trigger runs once and never backfills, so the role
has to be claimed:

1. Make sure `ADMIN_EMAILS` contains your address in Vercel, **redeploy**, then
   sign in again. The app reconciles your role on every sign-in, so being on
   the allowlist is enough — there is nothing to press.

   The address has to be **confirmed**, so that nobody who merely knows an
   owner's email can register it and take the restaurant. Google sign-in is
   already verified; with a password, `/account` will say so and offer to send
   the confirmation.
2. If that is not possible — the address is not on the allowlist, or you need
   to grant someone the `restaurant` role before any admin exists — do it
   directly from a machine with project access:

   ```bash
   gcloud auth application-default login
   GOOGLE_CLOUD_PROJECT=<project-id> \
     node scripts/grant-role.mjs you@example.com admin
   ```

   The same script grants `restaurant`. The Firebase console has no editor for
   custom claims, so there is no way to do this by hand in a browser.

An admin can preview the app as another role — **View as**, on `/account` and in
the account menu. It changes what you see, not what you can read: an admin
already passes the staff checks in `firestore.rules`, so the kitchen genuinely
works while previewing.

---

## Orders and the kitchen

A submitted week becomes an **order** plus one **prep task** per meal per day.
The kitchen board (`/kitchen`) reads those tasks directly, grouped by when they
have to be ready, with a mise-en-place roll-up summing every outstanding
ingredient for the day.

Three things are deliberately server-side, in the `submitOrder` Cloud Function:

- **The price and macros are recomputed** from the plan the server reads itself,
  using the same `calc`/`pricing` modules the browser uses. Nothing in the
  request is trusted.
- **The cutoff is enforced** in Bali time (`Asia/Makassar`). Orders for a week
  close on the configured day of the preceding week.
- **Orders cannot be created by a client at all** — the security rules deny it,
  so the function is the only path.

The restaurant never reads anyone's plan: the order carries its own copy of what
was ordered.

---

## Storage

Everything goes through one small `Repository<T>` interface with two backends:

- **`local`** — the browser's `localStorage`. Zero setup; this is guest mode.
- **`firebase`** — Cloud Firestore, scoped per account.

```
users/{uid}                                profile (role mirror, login metrics)
users/{uid}/plans/{planId}                 private to its owner
users/{uid}/dishes/{dishId}                private to its owner
restaurants/{rid}                          settings: cutoff, hours, mark-up
restaurants/{rid}/houseRecipes/{id}        public read — corrects everyone's macros
restaurants/{rid}/orders/{orderId}         written only by submitOrder
restaurants/{rid}/prepTasks/{taskId}       the kitchen board
```

The Firestore SDK is imported **lazily** inside the repository, so a guest never
downloads it — worth roughly 120 kB on every page.

---

## Deploying

Everything ships with the app. There is no second deploy to remember: the
server logic lives in the Next app's own API routes (`src/app/api/**`), so
pushing to your default branch deploys the site *and* the server together.

### 1. Vercel — the app and its server

Import the repo; Next.js is auto-detected. Then set the environment variables
under **Project → Settings → Environment Variables**.

Public — these are compiled into the browser bundle **by design**, since the
Firebase web config is not a secret and security lives in the rules:

```
NEXT_PUBLIC_STORAGE_BACKEND=firebase
NEXT_PUBLIC_FIREBASE_API_KEY=…
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=…
NEXT_PUBLIC_FIREBASE_PROJECT_ID=…
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=…
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=…
NEXT_PUBLIC_FIREBASE_APP_ID=…
NEXT_PUBLIC_RESTAURANT_ID=negrita
```

Server-only — **never** give these a `NEXT_PUBLIC_` prefix, or they ship to
every visitor's browser:

```
ADMIN_EMAILS=you@example.com
FIREBASE_SERVICE_ACCOUNT={"type":"service_account", … }
```

`ADMIN_EMAILS` is the owner allowlist: signing in with one of those addresses
grants admin automatically. `FIREBASE_SERVICE_ACCOUNT` is the whole contents of
a key from **Firebase console → Project settings → Service accounts → Generate
new private key**, pasted on one line. It is what lets the server stamp a role
onto a token and write the collections the rules deny to browsers.

**Redeploy after changing any of them.** The `NEXT_PUBLIC_*` values are inlined
at build time, so setting them is not enough on its own.

### 2. Firebase — rules and indexes

No Cloud Functions, so **no Blaze plan is required**: Firestore and
Authentication both run on the free Spark tier.

Two things still live in Firebase, and both can be published from the browser:

- **Rules** — Firestore → Rules → paste `firestore.rules` → Publish. Do this
  *before* switching the backend on, or every read is denied.
- **Indexes** — Firestore → Indexes, or follow the link in the error the first
  time a query needs one. The set is in `firestore.indexes.json`.

With the CLI, if you prefer: `firebase deploy --only firestore:rules,firestore:indexes`.

### 3. Before going live

- [ ] Firestore created in **production mode**, region `asia-southeast2`
- [ ] Email/Password and Google sign-in enabled
- [ ] Email enumeration protection ON
- [ ] Your Vercel domains added to **Authorized domains**
- [ ] Rules and indexes published
- [ ] `ADMIN_EMAILS` and `FIREBASE_SERVICE_ACCOUNT` set in Vercel, and you can
      reach `/admin` after signing in
- [ ] Submit one real week end to end and check it reaches `/kitchen`

Optional hardening, worth doing once there is real traffic: enable **App Check**
(reCAPTCHA Enterprise) for Firestore, and turn on scheduled Firestore backups.

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
src/lib/mealPlanner.ts               Auto-fill a week from macro targets
src/lib/clients.ts                   Plan totals, averages, adherence, cost
src/lib/cutoff.ts                    Bali-time order deadlines (shared with the server)
src/lib/orders.ts                    Plan -> order -> prep tasks (shared with the server)
src/lib/admin/analytics.ts           Revenue and customer roll-ups
src/lib/format.ts                    Rounding + Bali time helpers
src/lib/auth/                        AuthProvider, role claims, error copy
src/lib/storage/                     Repository (local + Firestore), orders, claim
src/store/                           Dish-builder + house-recipe state (Zustand)
src/components/ui/                   Button, Card, Modal, Field, Toast, DataTable…
src/components/                      Planner, builder, kitchen board, dashboard…
src/app/api/                         Server routes: auth sync, roles, orders
src/lib/server/                      Admin SDK, token verification, order + role logic
firestore.rules                      Access rules
firestore.indexes.json               Composite indexes for the queries above
```

### Routes

```
/                       Landing page
/login /signup /reset   Accounts
/plan                   My week          /plan/build    Build a dish
/plan/dishes            Saved dishes     /plan/report   Printable plan
/plan/submit            Send a week to the kitchen
/orders  /orders/[id]   A customer's orders and receipts
/kitchen                Today's prep board       (restaurant, admin)
/kitchen/[date]         A specific day           (restaurant, admin)
/kitchen/orders         The order book           (restaurant, admin)
/admin                  Owner dashboard          (admin)
/admin/settings         Cutoff, hours, roles     (admin)
/admin/house-items      House recipes            (restaurant, admin)
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
