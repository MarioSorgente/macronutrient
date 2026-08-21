"use client";

import { useEffect, useMemo, useState } from "react";
import { useRepos } from "@/lib/storage/repos";
import { loadCurrentPlan } from "@/lib/currentPlan";
import type { Plan, Dish } from "@/lib/storage/types";
import {
  byId,
  DAY_NAMES,
  assignmentMacros,
  assignmentName,
  assignmentPrice,
  assignmentsFor,
  dateFor,
  dayPrice,
  dayTotals,
  formatShortDate,
  weekDailyAverage,
  weekPrice,
  weekTotals,
} from "@/lib/clients";
import { formatIdr, formatPrice } from "@/lib/pricing";
import { round0, round1 } from "@/lib/format";
import MacroSummary from "@/components/MacroSummary";
import TargetAdherence from "@/components/TargetAdherence";
import ReportShell, { ReportMessage } from "@/components/ReportShell";

export default function PlanReport() {
  const repos = useRepos();
  const [plan, setClient] = useState<Plan | null>(null);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"all" | number>("all");

  useEffect(() => {
    if (repos.loading) return;
    Promise.all([
      loadCurrentPlan(repos.plans, repos.uid),
      repos.dishes.list(),
    ])
      .then(([loaded, d]) => {
        setClient(loaded);
        setDishes(d);
      })
      .catch((cause) => console.error("Could not load the report:", cause))
      .finally(() => setLoading(false));
  }, [repos]);

  const dishMap = useMemo(() => byId(dishes), [dishes]);

  if (loading) {
    return <ReportMessage>Loading report…</ReportMessage>;
  }

  if (!plan) return null;

  const weeks =
    scope === "all"
      ? Array.from({ length: plan.weekCount }, (_, i) => i + 1)
      : [scope];

  return (
    <ReportShell
      backHref="/plan"
      backLabel="Back to planner"
      kind="Meal plan"
      dateIso={plan.updatedAt}
      footnote="Some restaurant values are estimates; define house recipes to make them exact."
      toolbar={
        <select
          value={scope === "all" ? "all" : String(scope)}
          onChange={(e) =>
            setScope(e.target.value === "all" ? "all" : Number(e.target.value))
          }
          className="rounded-lg border border-cream-deep bg-white px-2.5 py-1.5 text-sm font-600 text-charcoal outline-none focus:border-tomato-soft"
          aria-label="Report scope"
        >
          <option value="all">Whole program</option>
          {Array.from({ length: plan.weekCount }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>
              Week {w} only
            </option>
          ))}
        </select>
      }
    >
          {/* Plan */}
          <div className="py-5">
            <h1 className="font-display text-3xl font-700 text-charcoal">
              {plan.title}
            </h1>
            <p className="mt-1 text-sm text-charcoal-soft">
              {scope === "all"
                ? `${plan.weekCount}-week program`
                : `Week ${scope}`}{" "}
              · starts {formatShortDate(dateFor(plan, 1, 0))}
            </p>
            {plan.notes && (
              <p className="mt-2 rounded-lg bg-cream px-3 py-2 text-sm text-charcoal-soft">
                {plan.notes}
              </p>
            )}
          </div>

          {weeks.map((week) => {
            const totals = weekTotals(plan, week, dishMap);
            const average = weekDailyAverage(plan, week, dishMap);
            const hasAny = assignmentsFor(plan, week).length > 0;

            return (
              <section
                key={week}
                className="mb-8 border-t border-cream-deep pt-5 last:mb-0"
              >
                <h2 className="font-display text-xl font-700 text-charcoal">
                  Week {week}
                </h2>
                <p className="mb-3 text-xs text-charcoal-soft">
                  {formatShortDate(dateFor(plan, week, 0))} –{" "}
                  {formatShortDate(dateFor(plan, week, 6))}
                </p>

                {!hasAny ? (
                  <p className="rounded-lg bg-cream px-3 py-4 text-sm text-charcoal-soft">
                    Nothing planned for this week.
                  </p>
                ) : (
                  <>
                    <MacroSummary macros={totals} />
                    <p className="mt-2 text-xs text-charcoal-soft">
                      Daily average:{" "}
                      <b className="text-charcoal">
                        {round0(average.energy_kcal)} kcal
                      </b>{" "}
                      · P {round1(average.protein_g)} g · C{" "}
                      {round1(average.carbs_g)} g · F {round1(average.fat_g)} g
                    </p>

                    {/* Cost */}
                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-cream px-3 py-2 text-xs">
                      <span className="text-charcoal-soft">
                        Week cost{" "}
                        <b className="tabular-nums text-charcoal">
                          {formatPrice(weekPrice(plan, week, dishMap))}
                        </b>
                      </span>
                      <span className="text-charcoal-soft">
                        Average per day{" "}
                        <b className="tabular-nums text-charcoal">
                          {formatIdr(
                            weekPrice(plan, week, dishMap).totalIdr / 7
                          )}
                        </b>
                      </span>
                      {!weekPrice(plan, week, dishMap).complete && (
                        <span className="text-gold">
                          Some items are not sold as DIY components, so the total
                          is a minimum.
                        </span>
                      )}
                    </div>

                    {plan.targets && (
                      <div className="mt-4">
                        <h3 className="mb-2 text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
                          Daily average vs target
                        </h3>
                        <TargetAdherence
                          actual={average}
                          targets={plan.targets}
                        />
                      </div>
                    )}

                    {/* Day-by-day */}
                    <div className="mt-5 space-y-3">
                      {DAY_NAMES.map((dayName, dayIndex) => {
                        const dayAssignments = assignmentsFor(
                          plan,
                          week,
                          dayIndex
                        );
                        if (!dayAssignments.length) return null;
                        const dTotals = dayTotals(plan, week, dayIndex, dishMap);

                        return (
                          <div
                            key={dayIndex}
                            className="break-inside-avoid rounded-lg border border-cream-deep"
                          >
                            <div className="flex items-baseline justify-between border-b border-cream-deep bg-cream px-3 py-1.5">
                              <span className="text-sm font-700 text-charcoal">
                                {dayName}
                                <span className="ml-2 text-[11px] font-500 text-charcoal-soft">
                                  {formatShortDate(dateFor(plan, week, dayIndex))}
                                </span>
                              </span>
                              <span className="text-xs font-600 tabular-nums text-charcoal-soft">
                                <b className="text-tomato">
                                  {round0(dTotals.energy_kcal)}
                                </b>{" "}
                                kcal · P {round1(dTotals.protein_g)} · C{" "}
                                {round1(dTotals.carbs_g)} · F{" "}
                                {round1(dTotals.fat_g)} ·{" "}
                                {formatPrice(
                                  dayPrice(plan, week, dayIndex, dishMap)
                                )}
                              </span>
                            </div>
                            <ul className="divide-y divide-cream-deep/60">
                              {plan.mealSlots.flatMap((slot) => {
                                const slotItems = dayAssignments.filter(
                                  (a) => a.slot === slot
                                );
                                return slotItems.map((a) => {
                                  const macros = assignmentMacros(a, dishMap);
                                  return (
                                    <li
                                      key={a.id}
                                      className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
                                    >
                                      <span className="min-w-0">
                                        <span className="mr-2 text-[10px] font-700 uppercase tracking-wide text-charcoal-soft">
                                          {slot}
                                        </span>
                                        <span className="text-charcoal">
                                          {assignmentName(a, dishMap)}
                                        </span>
                                        {a.servings !== 1 && (
                                          <span className="ml-1 text-xs text-charcoal-soft">
                                            ×{a.servings}
                                          </span>
                                        )}
                                      </span>
                                      <span className="shrink-0 text-xs tabular-nums text-charcoal-soft">
                                        <b className="text-tomato">
                                          {round0(macros.energy_kcal)}
                                        </b>{" "}
                                        kcal
                                        <span className="ml-2">
                                          {formatPrice(
                                            assignmentPrice(a, dishMap)
                                          )}
                                        </span>
                                      </span>
                                    </li>
                                  );
                                });
                              })}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </section>
            );
          })}

    </ReportShell>
  );
}


