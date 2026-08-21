"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  FileText,
  Plus,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { getClientRepository, getDishRepository } from "@/lib/storage";
import { MAX_PROGRAM_WEEKS, type Assignment, type Client, type Dish } from "@/lib/storage/types";
import {
  DAY_SHORT,
  assignmentMacros,
  assignmentName,
  assignmentPrice,
  assignmentsFor,
  dateFor,
  dayPrice,
  dayTotals,
  formatShortDate,
  isOrphaned,
  newAssignmentId,
  weekDailyAverage,
  weekPrice,
  weekTotals,
} from "@/lib/clients";
import { sumDishMacros } from "@/lib/calc";
import { formatIdr, formatPrice } from "@/lib/pricing";
import { usePlannerMode } from "@/lib/coachMode";
import type { GeneratedDay } from "@/lib/mealPlanner";
import { round0 } from "@/lib/format";
import MacroSummary from "@/components/MacroSummary";
import AssignDishDialog from "@/components/AssignDishDialog";
import ClientSettings from "@/components/ClientSettings";
import TargetAdherence from "@/components/TargetAdherence";
import PlannerModeToggle from "@/components/PlannerModeToggle";
import GeneratePlanDialog from "@/components/GeneratePlanDialog";

export default function ClientPlanner() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [client, setClient] = useState<Client | null>(null);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const [week, setWeek] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [mode, setMode] = usePlannerMode();
  const [assigning, setAssigning] = useState<{ day: number; slot: string } | null>(
    null
  );

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getClientRepository().get(id),
      getDishRepository().list(),
    ]).then(([c, d]) => {
      setClient(c);
      setDishes(d);
      setLoading(false);
    });
  }, [id]);

  const dishMap = useMemo(
    () => new Map(dishes.map((d) => [d.id, d])),
    [dishes]
  );

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

  function unassign(assignmentId: string) {
    if (!client) return;
    persist({
      ...client,
      plan: client.plan.filter((a) => a.id !== assignmentId),
    });
  }

  /** Writes a generated week into the plan as inline meals. */
  function applyGenerated(generated: GeneratedDay[], replace: boolean) {
    if (!client) return;
    const kept = replace
      ? client.plan.filter((a) => a.week !== currentWeek)
      : [...client.plan];

    const additions: Assignment[] = [];
    for (const day of generated) {
      for (const meal of day.meals) {
        additions.push({
          id: newAssignmentId(),
          week: currentWeek,
          day: day.day,
          slot: meal.slot,
          items: meal.items,
          servings: 1,
          price: { totalIdr: meal.price.totalIdr, complete: meal.price.complete },
          snapshot: { name: meal.name, totals: meal.macros },
          ...(meal.sourceDishId ? { dishId: meal.sourceDishId } : {}),
        });
      }
    }

    persist({ ...client, plan: [...kept, ...additions] });
    setGenerateOpen(false);
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-sm text-charcoal-soft">Loading planner…</p>
      </main>
    );
  }

  if (!client) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10 text-center">
        <p className="font-display text-xl font-700 text-charcoal">
          Client not found
        </p>
        <p className="mt-1 text-sm text-charcoal-soft">
          This client may have been saved on a different device or deleted.
        </p>
        <Link
          href="/clients"
          className="mt-4 inline-flex rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
        >
          Back to clients
        </Link>
      </main>
    );
  }

  const currentWeek = Math.min(week, client.weekCount);
  const totals = weekTotals(client, currentWeek, dishMap);
  const average = weekDailyAverage(client, currentWeek, dishMap);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/clients"
            className="mb-1 flex items-center gap-1.5 text-xs font-600 text-charcoal-soft hover:text-charcoal"
          >
            <ArrowLeft size={14} /> All clients
          </Link>
          <h1 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
            {client.name}
          </h1>
          <p className="mt-1 text-sm text-charcoal-soft">
            {client.weekCount}-week program · starts{" "}
            {formatShortDate(dateFor(client, 1, 0))}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PlannerModeToggle mode={mode} onChange={setMode} />
          {mode === "coach" && (
            <button
              type="button"
              onClick={() => setGenerateOpen(true)}
              className="flex items-center gap-1.5 rounded-xl bg-basil px-3 py-2 text-sm font-700 text-cream hover:opacity-90"
            >
              <Sparkles size={15} /> Generate plan
            </button>
          )}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-cream-deep bg-white px-3 py-2 text-sm font-600 text-charcoal hover:border-tomato-soft"
          >
            <Settings2 size={15} /> Settings
          </button>
          <Link
            href={`/clients/${client.id}/report`}
            className="flex items-center gap-1.5 rounded-xl bg-tomato px-3 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
          >
            <FileText size={15} /> Report
          </Link>
        </div>
      </div>

      {/* Coach summary: targets and what the week costs */}
      {mode === "coach" && (
        <section className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl2 border border-basil/30 bg-basil/5 px-4 py-3">
          <div>
            <div className="text-[11px] font-700 uppercase tracking-wide text-basil">
              Daily target
            </div>
            <div className="text-sm font-600 tabular-nums text-charcoal">
              {client.targets
                ? `${round0(client.targets.energy_kcal)} kcal · P ${round0(
                    client.targets.protein_g
                  )} · C ${round0(client.targets.carbs_g)} · F ${round0(
                    client.targets.fat_g
                  )}`
                : "Not set — open Settings or set them when generating"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-700 uppercase tracking-wide text-basil">
              Week {currentWeek} cost
            </div>
            <div className="text-sm font-700 tabular-nums text-charcoal">
              {formatPrice(weekPrice(client, currentWeek, dishMap))}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-700 uppercase tracking-wide text-basil">
              Avg / day
            </div>
            <div className="text-sm font-600 tabular-nums text-charcoal">
              {formatIdr(weekPrice(client, currentWeek, dishMap).totalIdr / 7)}
            </div>
          </div>
        </section>
      )}

      {/* Week switcher */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
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
            className="flex items-center gap-1 rounded-xl border border-dashed border-cream-deep px-3 py-2 text-sm font-600 text-charcoal-soft hover:border-tomato-soft hover:text-charcoal"
          >
            <Plus size={14} /> Add week
          </button>
        )}
      </div>

      {/* Day grid */}
      <div className="scroll-slim -mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="grid min-w-[64rem] grid-cols-7 gap-2">
          {DAY_SHORT.map((dayName, dayIndex) => {
            const totalsForDay = dayTotals(client, currentWeek, dayIndex, dishMap);
            const date = dateFor(client, currentWeek, dayIndex);
            return (
              <div
                key={dayIndex}
                className="flex flex-col rounded-xl2 border border-cream-deep bg-white/60 p-2"
              >
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <span className="font-display text-sm font-700 text-charcoal">
                    {dayName}
                  </span>
                  <span className="text-[10px] text-charcoal-soft">
                    {formatShortDate(date)}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-2">
                  {client.mealSlots.map((slot) => {
                    const slotAssignments = assignmentsFor(
                      client,
                      currentWeek,
                      dayIndex,
                      slot
                    );
                    return (
                      <div key={slot}>
                        <div className="mb-1 px-1 text-[10px] font-700 uppercase tracking-wide text-charcoal-soft">
                          {slot}
                        </div>
                        <ul className="flex flex-col gap-1">
                          {slotAssignments.map((a) => {
                            const macros = assignmentMacros(a, dishMap);
                            const orphan = isOrphaned(a, dishMap);
                            return (
                              <li
                                key={a.id}
                                className="group relative rounded-lg border border-cream-deep bg-cream px-2 py-1.5"
                              >
                                <div className="flex items-start justify-between gap-1">
                                  <span className="line-clamp-2 text-[11px] font-600 leading-tight text-charcoal">
                                    {assignmentName(a, dishMap)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => unassign(a.id)}
                                    className="shrink-0 rounded p-0.5 text-charcoal-soft opacity-0 transition-opacity hover:text-tomato-dark group-hover:opacity-100"
                                    aria-label="Remove from plan"
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] tabular-nums text-charcoal-soft">
                                  <span className="font-700 text-tomato">
                                    {round0(macros.energy_kcal)}
                                  </span>
                                  kcal
                                  {a.servings !== 1 && <span>×{a.servings}</span>}
                                  {mode === "coach" && (
                                    <span className="font-600">
                                      {formatPrice(assignmentPrice(a, dishMap))}
                                    </span>
                                  )}
                                  {orphan && (
                                    <AlertTriangle
                                      size={10}
                                      className="text-gold"
                                      aria-label="Original dish deleted; using saved snapshot"
                                    />
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                        <button
                          type="button"
                          onClick={() => setAssigning({ day: dayIndex, slot })}
                          className="mt-1 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-cream-deep py-1 text-[10px] font-600 text-charcoal-soft transition-colors hover:border-tomato-soft hover:text-tomato"
                        >
                          <Plus size={11} /> Add
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Day total */}
                <div className="mt-2 border-t border-cream-deep pt-1.5 text-center">
                  <div className="font-display text-sm font-700 text-charcoal">
                    {round0(totalsForDay.energy_kcal)}
                  </div>
                  <div className="text-[9px] uppercase tracking-wide text-charcoal-soft">
                    kcal
                  </div>
                  {mode === "coach" && (
                    <div className="text-[10px] font-600 tabular-nums text-charcoal-soft">
                      {formatPrice(dayPrice(client, currentWeek, dayIndex, dishMap))}
                    </div>
                  )}
                  {client.targets && (
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-cream-deep">
                      <span
                        className="block h-full bg-tomato"
                        style={{
                          width: `${Math.min(
                            100,
                            (totalsForDay.energy_kcal /
                              client.targets.energy_kcal) *
                              100
                          )}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Week summary */}
      <section className="mt-5 rounded-xl2 border border-cream-deep bg-white/60 p-4 shadow-card">
        <h2 className="mb-3 font-display text-lg font-700 text-charcoal">
          Week {currentWeek} summary
        </h2>
        <MacroSummary macros={totals} />
        <p className="mt-3 text-xs text-charcoal-soft">
          Daily average across 7 days:{" "}
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

      {assigning && (
        <AssignDishDialog
          dishes={dishes}
          slot={assigning.slot}
          dayLabel={`Week ${currentWeek} · ${DAY_SHORT[assigning.day]} ${formatShortDate(
            dateFor(client, currentWeek, assigning.day)
          )}`}
          onAssign={assign}
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
