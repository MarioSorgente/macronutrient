"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Plus, X } from "lucide-react";
import type { Assignment, Plan, Dish } from "@/lib/storage/types";
import {
  DAY_SHORT,
  DAY_NAMES,
  assignmentMacros,
  assignmentName,
  assignmentsFor,
  dateFor,
  dayPrice,
  dayTotals,
  formatShortDate,
  isOrphaned,
} from "@/lib/clients";
import { formatPrice } from "@/lib/pricing";
import { formatMacroGrams, round0 } from "@/lib/format";
import TargetAdherence from "@/components/TargetAdherence";
import { diagnoseDailyAdherence } from "@/lib/dailyAdherence";
import { dayIsComplete } from "@/lib/slotSuitability";
import { useBackdropClose } from "@/components/ui/useBackdropClose";

/**
 * Seven-day overview. Kept deliberately sparse: a meal shows its name and
 * calories, and everything else lives one click away in the meal dialog.
 */
export default function PlanWeekGrid({
  plan,
  week,
  dishes,
  showPrices,
  onOpenMeal,
  onAddMeal,
  locked = false,
}: {
  plan: Plan;
  week: number;
  dishes: Map<string, Dish>;
  showPrices: boolean;
  onOpenMeal: (assignment: Assignment) => void;
  onAddMeal: (day: number, slot: string) => void;
  /** The kitchen already has this week, so it is read-only here. */
  locked?: boolean;
}) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  return (
    <>
    <div className="scroll-slim -mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      <div className="grid min-w-[52rem] grid-cols-7 gap-2">
        {DAY_SHORT.map((dayName, dayIndex) => {
          const totals = dayTotals(plan, week, dayIndex, dishes);
          const price = dayPrice(plan, week, dayIndex, dishes);
          const date = dateFor(plan, week, dayIndex);
          // A snack is optional: a day that reaches its macros in three meals is
          // a complete day, and reading an empty Snack as a hole is what made a
          // generated three-meal day come back as "Impossible" once it was saved.
          const adherence = plan.targets ? diagnoseDailyAdherence(totals, plan.targets, {
            complete: dayIsComplete(plan.mealSlots, (slot) =>
              assignmentsFor(plan, week, dayIndex, slot).length > 0),
          }) : null;

          return (
            <div key={dayIndex} className="flex flex-col rounded-xl2 bg-white/60 p-2">
              <div className="mb-2 flex items-baseline justify-between px-1">
                <span className="font-display text-sm font-700 text-charcoal">
                  {dayName}
                </span>
                <span className="text-[10px] text-charcoal-soft">
                  {formatShortDate(date)}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-2">
                {plan.mealSlots.map((slot) => {
                  const slotAssignments = assignmentsFor(
                    plan,
                    week,
                    dayIndex,
                    slot
                  );
                  const empty = slotAssignments.length === 0;

                  return (
                    <div key={slot} className="hover-reveal-parent">
                      <div className="mb-1 px-1 text-[10px] font-700 uppercase tracking-wide text-charcoal-soft/70">
                        {slot}
                      </div>

                      <ul className="flex flex-col gap-1">
                        {slotAssignments.map((a) => (
                          <li key={a.id}>
                            <button
                              type="button"
                              onClick={() => onOpenMeal(a)}
                              className="group w-full rounded-lg bg-cream px-2 py-1.5 text-left transition-colors hover:bg-tomato-soft/20"
                            >
                              <span className="line-clamp-2 text-[11px] font-600 leading-tight text-charcoal">
                                {assignmentName(a, dishes)}
                              </span>
                              <span className="mt-0.5 flex items-center gap-1 text-[10px] tabular-nums text-charcoal-soft">
                                <b className="font-700 text-tomato">
                                  {round0(assignmentMacros(a, dishes).energy_kcal)}
                                </b>
                                {a.servings !== 1 && <span>×{a.servings}</span>}
                                {isOrphaned(a, dishes) && (
                                  <AlertTriangle
                                    size={10}
                                    className="text-gold"
                                    aria-label="Original dish deleted"
                                  />
                                )}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>

                      {/* Always offered on an empty slot; otherwise on hover. */}
                      <button
                        type="button"
                        onClick={() => onAddMeal(dayIndex, slot)}
                        disabled={locked}
                        title={locked ? "This week is with the kitchen." : undefined}
                        className={
                          "mt-1 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-cream-deep py-1 text-[10px] font-600 text-charcoal-soft transition-colors hover:border-tomato-soft hover:text-tomato disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-cream-deep disabled:hover:text-charcoal-soft " +
                          (empty ? "" : "hover-reveal")
                        }
                        aria-label={`Add to ${slot} on ${dayName}`}
                      >
                        <Plus size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setSelectedDay(dayIndex)}
                aria-pressed={selectedDay === dayIndex}
                aria-label={`View summary for ${DAY_NAMES[dayIndex]}, ${formatShortDate(date)}`}
                className="mt-2 w-full rounded-lg border-t border-cream-deep pt-1.5 text-center outline-none transition-colors hover:bg-cream focus-visible:ring-2 focus-visible:ring-tomato aria-pressed:bg-tomato-soft/10"
              >
                <div className="font-display text-sm font-700 text-charcoal">
                  {round0(totals.energy_kcal)}
                </div>
                <div className="text-[9px] uppercase tracking-wide text-charcoal-soft">
                  kcal
                </div>
                {showPrices && (
                  <div className="text-[10px] font-600 tabular-nums text-charcoal-soft">
                    {formatPrice(price)}
                  </div>
                )}
                {plan.targets && adherence && (
                  <div className="mt-2 text-left">
                    <TargetAdherence actual={totals} targets={plan.targets} diagnostics={adherence} presentation="summary" />
                  </div>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
    {selectedDay !== null && (
      <DailySummary
        plan={plan}
        week={week}
        day={selectedDay}
        dishes={dishes}
        onClose={() => setSelectedDay(null)}
      />
    )}
    </>
  );
}

function DailySummary({ plan, week, day, dishes, onClose }: {
  plan: Plan;
  week: number;
  day: number;
  dishes: Map<string, Dish>;
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const totals = dayTotals(plan, week, day, dishes);
  const price = dayPrice(plan, week, day, dishes);
  const date = dateFor(plan, week, day);
  const adherence = plan.targets ? diagnoseDailyAdherence(totals, plan.targets, {
    // The same rule the grid behind this panel uses: a snack the day went
    // without is not a hole in it. These two disagreeing meant one day read
    // "Within target" in the week and "Incomplete day" once you opened it.
    complete: dayIsComplete(plan.mealSlots, (slot) =>
      assignmentsFor(plan, week, day, slot).length > 0),
  }) : null;

  const backdrop = useBackdropClose(onClose);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-charcoal/40 lg:items-stretch lg:justify-end" role="dialog" aria-modal="true" aria-labelledby={titleId} {...backdrop}>
      <div ref={panelRef} tabIndex={-1} onClick={(event) => event.stopPropagation()} className="scroll-slim max-h-[90vh] w-full overflow-y-auto rounded-t-xl2 bg-cream p-5 shadow-card outline-none lg:h-full lg:max-h-none lg:max-w-md lg:rounded-none">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-700 uppercase tracking-wide text-charcoal-soft">Daily summary</p>
            <h2 id={titleId} className="font-display text-xl font-700 text-charcoal">{DAY_NAMES[day]}, {formatShortDate(date)}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close daily summary" className="rounded-lg p-2 text-charcoal-soft hover:bg-cream-deep focus-visible:ring-2 focus-visible:ring-tomato"><X size={18} /></button>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-2 rounded-xl2 bg-white/70 p-3 text-sm">
          <div><dt className="text-charcoal-soft">Calories</dt><dd className="font-700 tabular-nums">{round0(totals.energy_kcal)} kcal</dd></div>
          <div><dt className="text-charcoal-soft">Protein</dt><dd className="font-700 tabular-nums">{formatMacroGrams(totals.protein_g)} g</dd></div>
          <div><dt className="text-charcoal-soft">Carbohydrates</dt><dd className="font-700 tabular-nums">{formatMacroGrams(totals.carbs_g)} g</dd></div>
          <div><dt className="text-charcoal-soft">Fat</dt><dd className="font-700 tabular-nums">{formatMacroGrams(totals.fat_g)} g</dd></div>
          <div className="col-span-2 border-t border-cream-deep pt-2"><dt className="text-charcoal-soft">Price</dt><dd className="font-700 tabular-nums">{formatPrice(price)}</dd></div>
        </dl>
        {plan.targets && adherence ? (
          <div className="mt-4">
            <TargetAdherence actual={totals} targets={plan.targets} diagnostics={adherence} targetSource="Explicit" />
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-white/70 p-3 text-sm text-charcoal-soft">Set daily targets to see target values, deviations, and an adherence explanation.</p>
        )}
      </div>
    </div>
  );
}
