# Production-readiness QA report

Scope: a full QA pass over Mamma Calories — build a test harness where there
was none, cover the logic that decides what a customer is charged, exercise the
database and the Cloud Functions for real, audit every user action, and measure
before optimising.

Branch: `claude/production-readiness-qa-ru4hln`.

---

## Where it started

| | Before | After |
|---|---|---|
| `npm run lint` | Could not pass — `next lint` with no ESLint config and neither `eslint` nor `eslint-config-next` installed | Passes; flat config, `eslint` called directly |
| Unit tests | 29, in 7 files | **212**, in 17 files |
| `firestore.rules` | Untested | **58 tests**, one per rule branch |
| Cloud Functions | Untested | **60 tests** against the emulator |
| Browser tests | None | **37**, desktop + 375 px phone |
| CI | None | Lint → typecheck → unit → functions build → emulators → build → E2E |

Total: **212 unit + 118 emulated + 37 end-to-end.**

---

## Defects found and fixed

### 1. A cancelled order killed that week permanently — *critical, money path*

`onOrderStatusChanged` clears prep tasks and frees the week when an order is
cancelled, with the stated intent that the customer "can fix and resend it".
But `submitOrder`'s duplicate check queried `(userId, planId, weekNumber)` with
**no status filter**, so it still found the cancelled order and threw
`already-exists` — *"That week has already been sent to the kitchen."* Forever.

The customer cancels, the planner shows the week as editable again, and every
resubmit is rejected. The week is dead.

Fixed by counting only `LIVE_ORDER_STATUSES` as a blocking previous order. A
live order still blocks a second submit, covered by its own test so the fix
cannot become a licence to double-order. Regression test in
`tests/integration/orderLifecycle.test.ts`.

### 2. Sign out was unreachable — *the reported bug*

Sign out existed in exactly one place, the avatar dropdown, and that place was
inside the header's horizontally scrolling `<nav>`. `overflow-x: auto` forces
the computed `overflow-y` to `auto`, making the nav a scroll container in both
axes. Measured in a real browser with `document.elementFromPoint`, because
`isVisible()` and `boundingBox()` both ignore ancestor clipping:

| | Before | After |
|---|---|---|
| Sign out is the topmost painted element at its own centre | `false` — the hit returned `DIV.min-h-screen`, the page behind it | `true` |
| Avatar on screen at 375 px | `false` — laid out at x=441 in a 375 px viewport | `true` |

Compounding it: `/account` had no sign-out button at all, and `/orders/[id]`,
`/plan/report` and `/report/[id]` render with no site header, so a customer on
their own receipt had no account menu whatsoever.

Fixed: the account menu is a sibling of the nav, so only the links scroll;
`ReportShell` carries it too; `/account` has its own button.

### 3. Three profile fields nobody could ever set

`phone` and `defaultAddress` are declared on `UserProfile`, copied onto every
order by `submitOrder`, and shown to staff in `CustomerDetail` — but **no
screen had ever written either**. A delivery reached the kitchen with no way to
call the customer. `displayName` was settable only during sign-up.

`/account` now edits all three, plus a password reset. The security rules
already permitted exactly these fields, which is asserted by a rules test.

### 4. Profile forms seeded themselves blank over real data

Found while building the above. `AuthProvider` stamps `lastLoginAt`/`loginCount`
on `users/{uid}` on every sign-in. A read racing that write is answered with
Firestore's latency-compensated view: the pending mutation applied over
whatever base the SDK holds, which on a fresh page load is nothing. The
snapshot came back with only the stamp's six fields and
`hasPendingWrites: true` — no phone, no address.

`getDocFromServer` does **not** help; the SDK overlays pending mutations
regardless of read source. `readStoredProfile` (`src/lib/auth/profile.ts`)
waits, bounded, for `hasPendingWrites` to clear. Six unit tests, including the
pending-stamp case.

### 5. Five form labels associated with nothing — *accessibility*

`Field` only wires `htmlFor` to its control when children are passed as a
render prop. `PlanSettings` passed plain JSX children, so all five of its
labels pointed at an id no input had: clicking "Program starts" did not focus
the date input, and a screen reader announced it unlabelled. Every other
`Field` in the app already used the correct form — `PlanSettings` was the
outlier. "Meal slots" became a heading, since it labels a list rather than one
control, and the slot inputs got their own names.

### 6. Visible label ≠ accessible name — *WCAG 2.5.3*

`ConfirmButton` overrode its visible text with a different `aria-label`: the
receipt's button read **"Cancel this week"** and announced as **"Cancel this
order"**. Someone using voice control says what they can see, and the two did
not match. `label` now applies only to the icon-only form, where it is the sole
accessible name.

### 7. Two Firestore reads billed far more than they used

- The customer page read the **entire** users collection and 500 orders to
  display one customer. Now one document plus one indexed query. At a thousand
  customers that is a thousand document reads saved per page view.
- `listUsers()` was unbounded while every other collection read is capped. Now
  takes a limit, defaulting to 1000.

### 8. Four dead imports

Found by the ESLint config on its first run; each confirmed to appear only in
its own import statement.

---

## Verified, not changed

- **Cancelling an order** is already correctly gated: `OrderReceipt` shows the
  control only when `status === "submitted"` and the order belongs to the
  viewer, which matches what the rules permit.
- **The two `exhaustive-deps` warnings** in `IngredientPicker` and
  `HouseItemList` are **not** bugs. `version`/`houseVersion` are cache-busters
  for `getIngredient()`, which resolves house-recipe overrides at call time;
  removing them would stop a saved recipe from reaching the picker. Suppressed
  with the reason at each site.
- **A new plan cannot order its first week.** A fresh plan starts on *this*
  week's Monday, whose cutoff (the preceding Sunday, 18:00 Bali) has already
  passed. Working as designed — the person picks a later week — but worth
  knowing, and the E2E journey moves the start date the way a person would.

---

## Optimisation: measured, then mostly declined

`npm run bench`, on a full six-week plan (6 × 7 × 4 = 168 meals, the product's
ceiling):

| Hot path | mean |
|---|---|
| `generatePlan`, 7 days × 4 slots | 9.49 ms |
| Week-grid render pass | 0.022 ms |
| Day-view picker pass | 0.006 ms |
| `searchIngredients`, per keystroke | 0.024 ms |
| `getRecipe` × 25 | 0.0009 ms |

The render-path work originally planned — memoising `assignmentsFor` per cell,
`React.memo` on the two view components, a `Map` for `getRecipe`'s linear scan
— would buy **microseconds** against a React render measured in milliseconds.
Not done, deliberately: the complexity is real and the gain is not measurable.
The benchmark is committed so that stays true and a regression becomes visible.

The bundled nutrition JSON measures **163 KB raw / 26.9 KB gzipped** per route
that imports the database — real, but roughly a third of what a rough estimate
suggested, and not worth a build-time strip step against that number. First
Load JS is unchanged across every route.

What *was* expensive was Firestore reads, not CPU — see defect 7.

---

## Not covered

Stated plainly, so the remaining risk is written down rather than assumed away.

- **Account deletion.** No way for a person to delete their account. Doing it
  properly means cascading `users/{uid}`, their plans and their dishes, and
  deciding what happens to submitted orders the restaurant is still cooking —
  an order cannot simply vanish from the kitchen. That is a Cloud Function with
  its own tests. Specified here, not built.
- **App Check**, scheduled **Firestore backups**, and **payments** — all called
  out as future work in the README and untouched here.
- **`npm audit`** reports 3 high advisories in `postcss` and `sharp`, both
  transitive via `next`. Not actioned: upgrading Next mid-QA would invalidate
  the baseline. Worth doing as its own change.
- **Load and cost at scale.** The analytics roll-ups run in the browser over
  every order, which the code notes is fine at Negrita's volume and should be
  revisited "if the order book reaches a few thousand". Not exercised here.
- **The `restaurant` role's kitchen screens** have rules coverage but no
  end-to-end journey; the money path covers the customer side through to the
  order and prep tasks in the database.

---

## Running it

```bash
npm ci && npm --prefix functions ci
cp functions/.secret.example functions/.secret.local   # emulator ADMIN_EMAILS
npm run lint && npm run typecheck
npm test                  # 212 unit
npm run test:emulated     # 118 rules + Cloud Functions
npm run build
npm run e2e               # 37 browser tests, desktop + 375 px
```

All of it runs on every push via `.github/workflows/ci.yml`.
