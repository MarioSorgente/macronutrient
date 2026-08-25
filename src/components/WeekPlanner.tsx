"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  FileText,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useRepos } from "@/lib/storage/repos";
import {
  MAX_PROGRAM_WEEKS,
  type Assignment,
  type Plan,
  type ClientPreferences,
  type Dish,
  type DishItem,
  type MacroTargets,
} from "@/lib/storage/types";
import {
  byId,
  DAY_NAMES,
  assignmentsFor,
  dateFor,
  formatShortDate,
  newAssignmentId,
  weekPrice,
  weekTotals,
} from "@/lib/clients";
import { formatIdr, formatPrice, priceItems } from "@/lib/pricing";
import { usePlanView, useShowPrices } from "@/lib/planView";
import { EMPTY_MACROS, scaleMacros, sumDishMacros } from "@/lib/calc";
import { ZERO_PRICE } from "@/lib/pricing";
import { loadCurrentPlan, savePlan } from "@/lib/currentPlan";
import type { GeneratedDay } from "@/lib/mealPlanner";
import { assignmentsFromGenerated } from "@/lib/planAssignments";
import { menuRecipeForDish, withMenuIdentity } from "@/lib/menuIdentity";
import { negritaMenuCandidate } from "@/lib/plannerCandidates";
import { GRAM_UNIT_ID, type MenuRecipe } from "@/types/nutrition";
import { round0 } from "@/lib/format";
import MacroSummary from "@/components/MacroSummary";
import AssignDishDialog from "@/components/AssignDishDialog";
import PlanSettings from "@/components/PlanSettings";
import MacroTargetDialog from "@/components/MacroTargetDialog";
import { TargetSummary } from "@/components/MacroTargetEditor";
import TargetAdherence from "@/components/TargetAdherence";
import SegmentedToggle from "@/components/SegmentedToggle";
import GeneratePlanDialog from "@/components/GeneratePlanDialog";
import MealDetailDialog from "@/components/MealDetailDialog";
import PlanWeekGrid from "@/components/PlanWeekGrid";
import PlanDayView from "@/components/PlanDayView";
import EmptyState from "@/components/ui/EmptyState";
import ConfirmButton from "@/components/ui/ConfirmButton";
import HouseRecipeLoader from "@/components/HouseRecipeLoader";
import { getIngredient, isEstimated } from "@/lib/database";
import { useHouseRecipes } from "@/store/houseRecipes";

export default function WeekPlanner() {
  const repos = useRepos();
  // Re-render totals after a conditionally requested override set arrives.
  useHouseRecipes((state) => state.version);
  const [storedPlan, setClient] = useState<Plan | null>(null);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dishesLoading, setDishesLoading] = useState(true);
  const [dishesError, setDishesError] = useState<string | null>(null);
  const [week, setWeek] = useState(1);
  const [day, setDay] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [openMealId, setOpenMealId] = useState<string | null>(null);
  const [planView, setPlanView] = usePlanView();
  const [showPrices, setShowPrices] = useShowPrices();
  const [assigning, setAssigning] = useState<{ day: number; slot: string } | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /**
   * Which account the plan on screen was loaded for. A token expiry or a sign-out
   * in another tab flips `repos` to a different store, and nothing else ties the
   * plan in state to the repository it came from — so without this an edit made
   * a moment earlier can be written into the wrong person's storage.
   */
  const loadedFor = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    // In-app navigation is covered by the write barrier in currentPlan, which
    // makes the next load wait for a save in flight. Closing or reloading the
    // tab is the case it cannot cover: an unacknowledged Firestore write lives
    // in memory only, and goes with the page.
    if (!saving && !saveError) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saving, saveError]);

  useEffect(() => {
    // Wait for auth: reading first would open the guest store and then swap it
    // underneath the person once their account resolved.
    if (repos.loading) return;
    let active = true;

    loadCurrentPlan(repos.plans, repos.uid)
      .then((loaded) => {
        if (!active) return;
        loadedFor.current = repos.uid;
        setClient(loaded);
        setSaveError(null);
        // The plan is self-contained: assignment snapshots and inline items
        // are enough to render it while the dish library catches up.
      })
      .catch((cause) => {
        if (!active) return;
        // Without this a rejected read (an expired session, a denied rule)
        // leaves the planner on its loading line indefinitely, which reads as
        // a hang rather than as something the reader can act on.
        console.error("Could not load the planner:", cause);
        setLoadError(
          "We could not load your plan. Check your connection and reload."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    // Deliberately not awaited with the plan: a saved-dish library that is slow
    // or unreachable must not stop someone opening the week they already have.
    repos.dishes
      .list()
      .then((loadedDishes) => {
        if (active) setDishes(loadedDishes);
      })
      .catch((cause) => {
        if (!active) return;
        console.error("Could not load the dish library:", cause);
        setDishesError(
          "We could not load your saved dishes. Check your connection and try again."
        );
      })
      .finally(() => {
        if (active) setDishesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [repos]);

  const dishMap = useMemo(() => byId(dishes), [dishes]);

  /**
   * The plan, with any meal that is really a Negrita dish recognised as one.
   *
   * Done here because this is the one place holding both the plan and the saved
   * dishes it points at. In memory only: the week on screen reads the menu's
   * price and macros straight away, and the identity is written down by the next
   * ordinary save rather than by a surprise one on load.
   */
  const plan = useMemo(() => storedPlan && {
    ...storedPlan,
    assignments: storedPlan.assignments.map((assignment) =>
      withMenuIdentity(assignment, dishMap)),
  }, [storedPlan, dishMap]);
  const visibleWeekNeedsHouseRecipes = useMemo(() => {
    if (!plan) return false;
    return plan.assignments.some((assignment) => {
      if (assignment.week !== week) return false;
      const items = assignment.items ??
        (assignment.dishId ? dishMap.get(assignment.dishId)?.items : undefined);
      return items?.some((item) => {
        const ingredient = getIngredient(item.ingredientId);
        return ingredient ? isEstimated(ingredient) : false;
      }) ?? false;
    });
  }, [plan, dishMap, week]);

  // Every one of these walks the week's assignments and re-derives macros for
  // each meal. Unmemoised they ran on every render — three full passes for the
  // summary alone, before the grid adds one per day — which is what made a
  // full four-week plan feel sluggish to click around.
  const currentWeekSafe = plan ? Math.min(week, plan.weekCount) : 1;
  const weekSummary = useMemo(() => {
    if (!plan) return null;
    const totals = weekTotals(plan, currentWeekSafe, dishMap);
    return {
      totals,
      average: scaleMacros(totals, 1 / 7),
      cost: weekPrice(plan, currentWeekSafe, dishMap),
    };
  }, [plan, currentWeekSafe, dishMap]);

  /**
   * Saves a change and says so if it did not happen.
   *
   * The screen still updates first — the grid should never wait on a network —
   * but the write is now watched. It used to be issued and dropped: six of the
   * seven callers discarded the promise, so a rejected save left a fully
   * applied week on screen that had never been written, and the next time the
   * planner remounted it was simply gone with no explanation.
   *
   * Returns whether the write landed, so callers that should not move on until
   * it has (applying a whole generated week) can wait for it.
   */
  const persist = useCallback(async (next: Plan): Promise<boolean> => {
    if (loadedFor.current !== repos.uid) {
      setSaveError("You are signed in as someone else now. Reload to keep editing.");
      return false;
    }
    setClient(next);
    setSaving(true);
    setSaveError(null);
    try {
      const stored = await savePlan(repos.plans, repos.uid, next);
      setClient((current) => (current === next ? stored : current));
      return true;
    } catch (cause) {
      console.error("Could not save your plan:", cause);
      setSaveError(
        "We could not save your plan. Your week is still on screen — try again."
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, [repos]);

  function assign(dish: Dish, servings: number) {
    if (!plan || !assigning) return;
    // An untouched saved copy of a menu dish is that menu dish, and is priced
    // and counted as one. Anything you adjusted stays yours.
    const asMenuDish = menuRecipeForDish(dish);
    const assignment: Assignment = {
      id: newAssignmentId(),
      week,
      day: assigning.day,
      slot: assigning.slot,
      dishId: dish.id,
      servings,
      // Snapshot keeps the plan readable if this dish is later deleted.
      snapshot: { name: dish.name, totals: sumDishMacros(dish.items) },
      ...(asMenuDish ? { menuRecipeId: asMenuDish.recipe_id } : {}),
    };
    void persist({ ...plan, assignments: [...plan.assignments, assignment] });
    setAssigning(null);
  }

  /**
   * A Negrita dish, put straight into the slot as the dish the menu sells.
   *
   * `menuRecipeId` is the whole point: price and macros then resolve from the
   * menu on every read, so this reads 1,095 kcal and Rp 89,000 rather than the
   * 1,139 and Rp 15,000 its ingredient list adds up to. The components come
   * along for the kitchen and for display.
   */
  function assignMenuDish(recipe: MenuRecipe, servings: number) {
    if (!plan || !assigning) return;
    const candidate = negritaMenuCandidate(recipe);
    if (!candidate) return;
    const assignment: Assignment = {
      id: newAssignmentId(),
      week,
      day: assigning.day,
      slot: assigning.slot,
      servings,
      items: candidate.breakdown.map((item) => ({
        ingredientId: item.ingredientId, name: item.name, grams: item.grams,
        unitId: GRAM_UNIT_ID, quantity: item.grams,
      })),
      price: { totalIdr: candidate.price.totalIdr, complete: candidate.price.complete },
      snapshot: { name: candidate.displayName, totals: candidate.optimizerMacros },
      menuRecipeId: recipe.recipe_id,
    };
    void persist({ ...plan, assignments: [...plan.assignments, assignment] });
    setAssigning(null);
  }

  /**
   * A meal built in the popup goes into the plan inline, exactly like a
   * generated one, so the dish library stays clean unless you ask to
   * keep it.
   */
  async function assignCustom(
    name: string,
    items: DishItem[],
    servings: number,
    alsoSave: boolean
  ) {
    if (!plan || !assigning) return;
    const totals = sumDishMacros(items);
    const price = priceItems(items);

    let dishId: string | undefined;
    if (alsoSave) {
      const now = new Date().toISOString();
      const dish: Dish = {
        id: crypto.randomUUID(),
        name,
        items,
        totals,
        createdAt: now,
        updatedAt: now,
      };
      await repos.dishes.save(dish);
      setDishes(await repos.dishes.list());
      dishId = dish.id;
    }

    const assignment: Assignment = {
      id: newAssignmentId(),
      week,
      day: assigning.day,
      slot: assigning.slot,
      items,
      servings,
      price: { totalIdr: price.totalIdr, complete: price.complete },
      snapshot: { name, totals },
      ...(dishId ? { dishId } : {}),
    };
    void persist({ ...plan, assignments: [...plan.assignments, assignment] });
    setAssigning(null);
  }

  /**
   * Empties the week on screen.
   *
   * Only the visible week, and never one already sent to the kitchen — the
   * restaurant is cooking from that, so it has to be cancelled rather than
   * quietly emptied.
   */
  function clearWeek() {
    if (!plan) return;
    void persist({
      ...plan,
      assignments: plan.assignments.filter((a) => a.week !== currentWeekSafe),
    });
    setOpenMealId(null);
  }

  function unassign(assignmentId: string) {
    if (!plan) return;
    void persist({
      ...plan,
      assignments: plan.assignments.filter((a) => a.id !== assignmentId),
    });
    setOpenMealId(null);
  }

  /** Applies a patch to one assignment and saves. */
  function updateAssignment(assignmentId: string, patch: Partial<Assignment>) {
    if (!plan) return;
    void persist({
      ...plan,
      assignments: plan.assignments.map((a) =>
        a.id === assignmentId ? { ...a, ...patch } : a
      ),
    });
  }

  /** Writes a generated week into the plan as inline meals. */
  async function applyGenerated(
    generated: GeneratedDay[],
    replace: boolean,
    preferences: ClientPreferences,
    resolvedTarget: MacroTargets,
    targetMode: Plan["targetMode"],
    targetPreset?: Plan["targetPreset"]
  ): Promise<boolean> {
    if (!plan) return false;
    const kept = replace
      ? plan.assignments.filter((a) => a.week !== currentWeek)
      : [...plan.assignments];

    const additions = assignmentsFromGenerated(generated, currentWeek);

    // Tastes are remembered with the plan, so the next generation starts from
    // what you already told the generator — and so is the target the week was
    // actually generated against. Without it a plan generated from a derived
    // "Auto → Balanced 2000 kcal" target saved with no target at all, and the
    // adherence bars afterwards measured the week against nothing.
    // The one write worth waiting for: twenty-odd assignments, the resolved
    // target and the preferences, all at once. The dialog stays open if it
    // fails, so the generated week is still in hand rather than lost.
    const saved = await persist({ ...plan, preferences, targets: resolvedTarget,
      targetMode, ...(targetMode === "preset" ? { targetPreset } : { targetPreset: undefined }),
      assignments: [...kept, ...additions] });
    if (saved) setGenerateOpen(false);
    return saved;
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-sm text-charcoal-soft">Loading planner…</p>
      </main>
    );
  }

  if (loadError || !plan) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={<AlertTriangle size={22} />}
          title="Your plan did not load"
          hint={loadError ?? "Something went wrong reading your week."}
          action={
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
            >
              Try again
            </button>
          }
        />
      </main>
    );
  }

  const currentWeek = Math.min(week, plan.weekCount);

  // Re-read from the plan so the dialog reflects edits made inside it.
  const { totals, average, cost } = weekSummary ?? {
    totals: EMPTY_MACROS,
    average: EMPTY_MACROS,
    cost: ZERO_PRICE,
  };

  const openMeal = openMealId
    ? plan.assignments.find((a) => a.id === openMealId) ?? null
    : null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <HouseRecipeLoader enabled={visibleWeekNeedsHouseRecipes} />

      {/*
        Sticky, not a toast. A toast that dismisses itself is the wrong shape
        for "your week is not saved": the week is still on screen, so nothing
        else on the page tells the person anything is wrong.
      */}
      {saveError && (
        <div
          role="alert"
          data-testid="save-error"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-tomato bg-tomato/5 px-4 py-3 text-sm text-charcoal"
        >
          <AlertTriangle size={16} className="shrink-0 text-tomato" />
          <span className="min-w-0 flex-1 font-600">{saveError}</span>
          <button
            type="button"
            onClick={() => void persist(plan)}
            disabled={saving}
            className="rounded-lg bg-tomato px-3 py-1.5 text-xs font-700 text-cream hover:bg-tomato-dark disabled:opacity-50"
          >
            {saving ? "Saving…" : "Try again"}
          </button>
        </div>
      )}
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
            {plan.title}
          </h1>
          <p className="mt-1 text-sm text-charcoal-soft">
            {plan.weekCount}-week program · starts{" "}
            {formatShortDate(dateFor(plan, 1, 0))}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setGenerateOpen(true)}
            disabled={dishesLoading || Boolean(dishesError)}
            title={
              dishesLoading
                ? "Loading your dish library…"
                : dishesError ?? undefined
            }
            className="flex items-center gap-1.5 rounded-xl bg-basil px-3 py-2 text-sm font-700 text-cream hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles size={15} /> Auto-fill my week
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-cream-deep bg-white px-3 py-2 text-sm font-600 text-charcoal hover:border-tomato-soft"
          >
            <Settings2 size={15} /> Settings
          </button>
          <Link
            href="/plan/report"
            className="flex items-center gap-1.5 rounded-xl border border-cream-deep bg-white px-3 py-2 text-sm font-600 text-charcoal hover:border-tomato-soft"
          >
            <FileText size={15} /> Report
          </Link>
          <Link
            href="/plan/submit"
            className="flex items-center gap-1.5 rounded-xl bg-tomato px-3 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
          >
            <Send size={15} /> Send to kitchen
          </Link>
        </div>
      </div>

      {/* Daily goals are a primary planner control, including an intentional onboarding state. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-tomato/30 bg-white p-4 shadow-sm">
        <div>
          <div className="mb-1 text-xs font-700 uppercase tracking-wide text-tomato-dark">Daily targets</div>
          {plan.targets ? <TargetSummary selection={{ targets: plan.targets, mode: plan.targetMode, preset: plan.targetPreset }} /> : <>
            <div className="font-display text-lg font-700 text-charcoal">Set daily targets</div>
            <p className="text-xs text-charcoal-soft">Add calories and macro goals to guide auto-fill and track each day.</p>
          </>}
        </div>
        <button type="button" onClick={() => setTargetsOpen(true)} className="rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark">
          {plan.targets ? "Edit targets" : "Set daily targets"}
        </button>
      </div>

      {/* Week summary — one line, not three stacked blocks */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-basil/30 bg-basil/5 px-3 py-2 text-sm">
        <span className="text-charcoal-soft">
          Week {currentWeek}{" "}
          <b className="tabular-nums text-charcoal">{formatPrice(cost)}</b>
        </span>
        <span className="text-charcoal-soft">
          Avg/day{" "}
          <b className="tabular-nums text-charcoal">
            {formatIdr(cost.totalIdr / 7)}
          </b>
        </span>
        <button
          type="button"
          onClick={() => setShowPrices(!showPrices)}
          className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-600 text-charcoal-soft hover:text-charcoal"
          aria-pressed={showPrices}
        >
          <Wallet size={13} /> {showPrices ? "Hide prices" : "Show prices"}
        </button>
      </div>

      {/* Week switcher + view toggle */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {Array.from({ length: plan.weekCount }, (_, i) => i + 1).map((w) => {
            const count = assignmentsFor(plan, w).length;
            return (
              <button
                key={w}
                type="button"
                onClick={() => setWeek(w)}
                className={
                  "flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-600 transition-colors " +
                  (w === currentWeek
                    ? "bg-charcoal text-cream"
                    : "bg-cream-deep text-charcoal-soft hover:text-charcoal")
                }
              >
                Week {w}
                {count > 0 && (
                  <span
                    className={
                      "rounded-full px-1.5 text-[10px] font-700 " +
                      (w === currentWeek
                        ? "bg-cream/20 text-cream"
                        : "bg-white text-charcoal-soft")
                    }
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          {plan.weekCount < MAX_PROGRAM_WEEKS && (
            <button
              type="button"
              onClick={() =>
                void persist({ ...plan, weekCount: plan.weekCount + 1 })
              }
              className="flex items-center gap-1 rounded-xl border border-dashed border-cream-deep px-2.5 py-2 text-sm font-600 text-charcoal-soft hover:border-tomato-soft hover:text-charcoal"
              aria-label="Add week"
            >
              <Plus size={14} />
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {assignmentsFor(plan, currentWeekSafe).length > 0 && (
            <ConfirmButton
              text={`Clear week ${currentWeekSafe}`}
              confirmLabel={`Clear all ${assignmentsFor(plan, currentWeekSafe).length}?`}
              label={`Clear every meal in week ${currentWeekSafe}`}
              disabled={plan.submittedWeeks?.includes(currentWeekSafe)}
              onConfirm={clearWeek}
            />
          )}
          <SegmentedToggle
            ariaLabel="Plan view"
            value={planView}
            onChange={setPlanView}
            options={[
              { value: "day", label: "Day", icon: <CalendarDays size={14} /> },
              { value: "week", label: "Week", icon: <CalendarRange size={14} /> },
            ]}
          />
        </div>
      </div>

      {/* The plan */}
      {planView === "day" ? (
        <PlanDayView
          plan={plan}
          week={currentWeek}
          day={day}
          dishes={dishMap}
          showPrices={showPrices}
          onSelectDay={setDay}
          onOpenMeal={(a) => setOpenMealId(a.id)}
          onAddMeal={(d, slot) => setAssigning({ day: d, slot })}
        />
      ) : (
        <>
          <PlanWeekGrid
            plan={plan}
            week={currentWeek}
            dishes={dishMap}
            showPrices={showPrices}
            onOpenMeal={(a) => setOpenMealId(a.id)}
            onAddMeal={(d, slot) => setAssigning({ day: d, slot })}
          />

          <section className="mt-5 rounded-xl2 border border-cream-deep bg-white/60 p-4">
            <h2 className="mb-3 font-display text-lg font-700 text-charcoal">
              Week {currentWeek} total
            </h2>
            <MacroSummary macros={totals} />
            <p className="mt-3 text-xs text-charcoal-soft">
              Daily average:{" "}
              <b className="text-charcoal">{round0(average.energy_kcal)} kcal</b>
            </p>
            {plan.targets && (
              <div className="mt-4 border-t border-cream-deep pt-4">
                <h3 className="mb-2 text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
                  Daily average vs target
                </h3>
                <TargetAdherence actual={average} targets={plan.targets} />
              </div>
            )}
          </section>
        </>
      )}

      {/* Dialogs */}
      {openMeal && (
        <MealDetailDialog
          assignment={openMeal}
          dishes={dishMap}
          contextLabel={`${openMeal.slot} · ${DAY_NAMES[openMeal.day]}, ${formatShortDate(
            dateFor(plan, openMeal.week, openMeal.day)
          )}`}
          onChangeServings={(servings) =>
            updateAssignment(openMeal.id, { servings })
          }
          onRemove={() => unassign(openMeal.id)}
          onClose={() => setOpenMealId(null)}
        />
      )}

      {assigning && (
        <AssignDishDialog
          dishes={dishes}
          dishesLoading={dishesLoading}
          dishesError={dishesError}
          slot={assigning.slot}
          dayLabel={`Week ${currentWeek} · ${DAY_NAMES[assigning.day]} ${formatShortDate(
            dateFor(plan, currentWeek, assigning.day)
          )}`}
          onAssign={assign}
          onAssignMenuDish={assignMenuDish}
          onAssignCustom={assignCustom}
          onClose={() => setAssigning(null)}
        />
      )}

      {generateOpen && (
        <GeneratePlanDialog
          plan={plan}
          week={currentWeek}
          savedDishes={dishes}
          onApply={applyGenerated}
          onTargetsSave={async (selection) => {
            await persist({ ...plan, targets: selection.targets, targetMode: selection.mode,
              ...(selection.mode === "preset" ? { targetPreset: selection.preset } : { targetPreset: undefined }) });
          }}
          onClose={() => setGenerateOpen(false)}
        />
      )}

      {targetsOpen && (
        <MacroTargetDialog plan={plan} onSave={async (selection) => {
          await persist({ ...plan, targets: selection.targets, targetMode: selection.mode,
            ...(selection.mode === "preset" ? { targetPreset: selection.preset } : { targetPreset: undefined }) });
          setTargetsOpen(false);
        }} onClose={() => setTargetsOpen(false)} />
      )}

      {settingsOpen && (
        <PlanSettings
          plan={plan}
          onSave={async (next) => {
            await persist(next);
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}
