"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  FileText,
  Plus,
  Settings2,
  Sparkles,
  Wallet,
} from "lucide-react";
import { getClientRepository, getDishRepository } from "@/lib/storage";
import {
  MAX_PROGRAM_WEEKS,
  type Assignment,
  type Client,
  type ClientPreferences,
  type Dish,
  type DishItem,
} from "@/lib/storage/types";
import {
  byId,
  DAY_NAMES,
  assignmentsFor,
  dateFor,
  formatShortDate,
  newAssignmentId,
  weekDailyAverage,
  weekPrice,
  weekTotals,
} from "@/lib/clients";
import { sumDishMacros } from "@/lib/calc";
import { formatIdr, formatPrice, priceItems } from "@/lib/pricing";
import { usePlanView, useShowPrices } from "@/lib/planView";
import { loadCurrentPlan } from "@/lib/currentPlan";
import type { GeneratedDay } from "@/lib/mealPlanner";
import { round0 } from "@/lib/format";
import MacroSummary from "@/components/MacroSummary";
import AssignDishDialog from "@/components/AssignDishDialog";
import ClientSettings from "@/components/ClientSettings";
import TargetAdherence from "@/components/TargetAdherence";
import SegmentedToggle from "@/components/SegmentedToggle";
import GeneratePlanDialog from "@/components/GeneratePlanDialog";
import MealDetailDialog from "@/components/MealDetailDialog";
import PlanWeekGrid from "@/components/PlanWeekGrid";
import PlanDayView from "@/components/PlanDayView";
import EmptyState from "@/components/ui/EmptyState";
import HouseRecipeLoader from "@/components/HouseRecipeLoader";
import { getIngredient, isEstimated } from "@/lib/database";
import { useHouseRecipes } from "@/store/houseRecipes";

export default function ClientPlanner() {
  // Re-render totals after a conditionally requested override set arrives.
  useHouseRecipes((state) => state.version);
  const [client, setClient] = useState<Client | null>(null);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dishesLoading, setDishesLoading] = useState(true);
  const [dishesError, setDishesError] = useState<string | null>(null);
  const [week, setWeek] = useState(1);
  const [day, setDay] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [openMealId, setOpenMealId] = useState<string | null>(null);
  const [planView, setPlanView] = usePlanView();
  const [showPrices, setShowPrices] = useShowPrices();
  const [assigning, setAssigning] = useState<{ day: number; slot: string } | null>(
    null
  );

  useEffect(() => {
    let active = true;

    loadCurrentPlan()
      .then((plan) => {
        if (!active) return;
        setClient(plan);
        // The plan is self-contained: assignment snapshots and inline items
        // are enough to render it while the dish library catches up.
        setLoading(false);
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
        setLoading(false);
      })

    getDishRepository()
      .list()
      .then((loadedDishes) => {
        if (!active) return;
        setDishes(loadedDishes);
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
  }, []);

  const dishMap = useMemo(() => byId(dishes), [dishes]);
  const visibleWeekNeedsHouseRecipes = useMemo(() => {
    if (!client) return false;
    return client.plan.some((assignment) => {
      if (assignment.week !== week) return false;
      const items = assignment.items ??
        (assignment.dishId ? dishMap.get(assignment.dishId)?.items : undefined);
      return items?.some((item) => {
        const ingredient = getIngredient(item.ingredientId);
        return ingredient ? isEstimated(ingredient) : false;
      }) ?? false;
    });
  }, [client, dishMap, week]);

  const persist = useCallback(async (next: Client) => {
    const updated = { ...next, updatedAt: new Date().toISOString() };
    setClient(updated);
    await getClientRepository().save(updated);
  }, []);

  function assign(dish: Dish, servings: number) {
    if (!client || !assigning) return;
    const assignment: Assignment = {
      id: newAssignmentId(),
      week,
      day: assigning.day,
      slot: assigning.slot,
      dishId: dish.id,
      servings,
      // Snapshot keeps the plan readable if this dish is later deleted.
      snapshot: { name: dish.name, totals: sumDishMacros(dish.items) },
    };
    persist({ ...client, plan: [...client.plan, assignment] });
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
    if (!client || !assigning) return;
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
      await getDishRepository().save(dish);
      setDishes(await getDishRepository().list());
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
    persist({ ...client, plan: [...client.plan, assignment] });
    setAssigning(null);
  }

  function unassign(assignmentId: string) {
    if (!client) return;
    persist({
      ...client,
      plan: client.plan.filter((a) => a.id !== assignmentId),
    });
    setOpenMealId(null);
  }

  /** Applies a patch to one assignment and saves. */
  function updateAssignment(assignmentId: string, patch: Partial<Assignment>) {
    if (!client) return;
    persist({
      ...client,
      plan: client.plan.map((a) =>
        a.id === assignmentId ? { ...a, ...patch } : a
      ),
    });
  }

  /** Writes a generated week into the plan as inline meals. */
  function applyGenerated(
    generated: GeneratedDay[],
    replace: boolean,
    preferences: ClientPreferences
  ) {
    if (!client) return;
    const kept = replace
      ? client.plan.filter((a) => a.week !== currentWeek)
      : [...client.plan];

    const additions: Assignment[] = [];
    for (const gDay of generated) {
      for (const meal of gDay.meals) {
        additions.push({
          id: newAssignmentId(),
          week: currentWeek,
          day: gDay.day,
          slot: meal.slot,
          items: meal.items,
          servings: 1,
          price: { totalIdr: meal.price.totalIdr, complete: meal.price.complete },
          snapshot: { name: meal.name, totals: meal.macros },
          ...(meal.sourceDishId ? { dishId: meal.sourceDishId } : {}),
        });
      }
    }

    // Tastes are remembered with the plan, so the next generation starts from
    // what you already told the generator.
    persist({ ...client, preferences, plan: [...kept, ...additions] });
    setGenerateOpen(false);
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-sm text-charcoal-soft">Loading planner…</p>
      </main>
    );
  }

  if (loadError || !client) {
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

  const currentWeek = Math.min(week, client.weekCount);
  const totals = weekTotals(client, currentWeek, dishMap);
  const average = weekDailyAverage(client, currentWeek, dishMap);
  const cost = weekPrice(client, currentWeek, dishMap);

  // Re-read from the plan so the dialog reflects edits made inside it.
  const openMeal = openMealId
    ? client.plan.find((a) => a.id === openMealId) ?? null
    : null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <HouseRecipeLoader enabled={visibleWeekNeedsHouseRecipes} />
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
            {client.name}
          </h1>
          <p className="mt-1 text-sm text-charcoal-soft">
            {client.weekCount}-week program · starts{" "}
            {formatShortDate(dateFor(client, 1, 0))}
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
            className="flex items-center gap-1.5 rounded-xl bg-tomato px-3 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
          >
            <FileText size={15} /> Report
          </Link>
        </div>
      </div>

      {/* Week summary — one line, not three stacked blocks */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-basil/30 bg-basil/5 px-3 py-2 text-sm">
        <span className="text-charcoal-soft">
          Target{" "}
          <b className="tabular-nums text-charcoal">
            {client.targets
              ? `${round0(client.targets.energy_kcal)} kcal · P ${round0(
                  client.targets.protein_g
                )}`
              : "not set"}
          </b>
        </span>
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
          {Array.from({ length: client.weekCount }, (_, i) => i + 1).map((w) => {
            const count = assignmentsFor(client, w).length;
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
          {client.weekCount < MAX_PROGRAM_WEEKS && (
            <button
              type="button"
              onClick={() =>
                persist({ ...client, weekCount: client.weekCount + 1 })
              }
              className="flex items-center gap-1 rounded-xl border border-dashed border-cream-deep px-2.5 py-2 text-sm font-600 text-charcoal-soft hover:border-tomato-soft hover:text-charcoal"
              aria-label="Add week"
            >
              <Plus size={14} />
            </button>
          )}
        </div>

        <div className="ml-auto">
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
          client={client}
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
            client={client}
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
            {client.targets && (
              <div className="mt-4 border-t border-cream-deep pt-4">
                <h3 className="mb-2 text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
                  Daily average vs target
                </h3>
                <TargetAdherence actual={average} targets={client.targets} />
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
            dateFor(client, openMeal.week, openMeal.day)
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
            dateFor(client, currentWeek, assigning.day)
          )}`}
          onAssign={assign}
          onAssignCustom={assignCustom}
          onClose={() => setAssigning(null)}
        />
      )}

      {generateOpen && (
        <GeneratePlanDialog
          client={client}
          week={currentWeek}
          savedDishes={dishes}
          onApply={applyGenerated}
          onClose={() => setGenerateOpen(false)}
        />
      )}

      {settingsOpen && (
        <ClientSettings
          client={client}
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
