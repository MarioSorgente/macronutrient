# Mamma Calories — For Negrita

A simple, restaurant-focused macro builder (think MyFitnessPal, but simpler and
for a kitchen). Pick ingredients from Negrita's nutrition database, set the grams
for each, combine them into a **dish**, watch the macros add up, **save** the
dish, and generate a **printable report**.

Built with **Next.js (App Router) + TypeScript + Tailwind CSS**, deployed on
**Vercel**.

---

## What it does

- **Ingredient picker** — search 91 ingredients by name, category, or menu wording.
- **Dish builder** — set grams per ingredient; totals (calories, protein, carbs,
  fat, fiber) and the protein/carb/fat energy split update live.
- **Menu templates** — load any of Negrita's 25 menu dishes as an editable
  starting point (quantities not printed on the menu load as 0 to fill in).
- **Save dishes** — stored in the browser today (see *Storage* below).
- **Reports** — a clean, print-optimized page you can Print or Save as PDF.

Macros follow the database's own rule: `grams ÷ 100 × value per 100 g`, summed
across ingredients.

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

Saved dishes use a small `DishRepository` interface with two interchangeable
backends:

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
> authentication. Dishes are stored in a `dishes` collection, one document per
> dish.

---

## Project structure

```
data/negrita-database.json      Bundled nutrition database (source of truth)
src/types/nutrition.ts          Ingredient / MenuRecipe / Macros types
src/lib/database.ts             Load + index + search ingredients & recipes
src/lib/calc.ts                 Macro calculation helpers
src/lib/storage/                DishRepository: local (now) + firebase (prepared)
src/store/dishBuilder.ts        Dish-builder cart state (Zustand)
src/components/                 UI (picker, builder, report, templates, …)
src/app/                        Routes: / (builder), /dishes, /report/[id]
```

---

## Not included yet (easy future additions)

Confidence badges (the DB flags which values are proxies vs verified USDA),
ingredient/dish cost in IDR, per-serving splitting, and in-place editing of saved
dishes. The data to support all of these is already in the bundled database.
