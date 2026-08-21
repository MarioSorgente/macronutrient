"use client";

import { AlertTriangle, Plus } from "lucide-react";
import type { Assignment, Plan, Dish } from "@/lib/storage/types";
import {
  DAY_NAMES,
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
} from "@/lib/clients";
import { formatPrice } from "@/lib/pricing";
import { round0 } from "@/lib/format";
import MacroSummary from "@/components/MacroSummary";
import TargetAdherence from "@/components/TargetAdherence";
import MacroChips from "@/components/MacroChips";

/**
 * One day, full width. The week grid has to truncate names to fit seven
 * columns; here there is room to read what a meal actually is.
 */
export default function PlanDayView({
  plan,
  week,
  day,
  dishes,
  showPrices,
  onSelectDay,
  onOpenMeal,
  onAddMeal,
}: {
  plan: Plan;
  week: number;
  day: number;
  dishes: Map<string, Dish>;
  showPrices: boolean;
  onSelectDay: (day: number) => void;
  onOpenMeal: (assignment: Assignment) => void;
  onAddMeal: (day: number, slot: string) => void;
}) {
  const totals = dayTotals(plan, week, day, dishes);
  const price = dayPrice(plan, week, day, dishes);

  return (
    <div>
      {/* Day picker */}
      <div className="scroll-slim -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {DAY_SHORT.map((name, index) => {
          const dayKcal = dayTotals(plan, week, index, dishes).energy_kcal;
          const active = index === day;
          return (
            <button
              key={index}
              type="button"
              onClick={() => onSelectDay(index)}
              className={
                "flex min-w-[4.5rem] shrink-0 flex-col items-center rounded-xl px-3 py-2 transition-colors " +
                (active
                  ? "bg-charcoal text-cream"
                  : "bg-cream-deep text-charcoal-soft hover:text-charcoal")
              }
            >
              <span className="text-sm font-700">{name}</span>
              <span
                className={
                  "text-[10px] tabular-nums " +
                  (active ? "text-cream/70" : "text-charcoal-soft")
                }
              >
                {dayKcal > 0 ? `${round0(dayKcal)} kcal` : "—"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Day header */}
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-700 text-charcoal">
          {DAY_NAMES[day]}
          <span className="ml-2 text-sm font-500 text-charcoal-soft">
            {formatShortDate(dateFor(plan, week, day))}
          </span>
        </h2>
        {showPrices && (
          <span className="text-sm font-600 tabular-nums text-charcoal-soft">
            {formatPrice(price)}
          </span>
        )}
      </div>

      {/* Slots */}
      <div className="flex flex-col gap-3">
        {plan.mealSlots.map((slot) => {
          const slotAssignments = assignmentsFor(plan, week, day, slot);
          return (
            <section key={slot} className="hover-reveal-parent">
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="text-[11px] font-700 uppercase tracking-[0.14em] text-charcoal-soft">
                  {slot}
                </h3>
                <button
                  type="button"
                  onClick={() => onAddMeal(day, slot)}
                  className={
                    "flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-600 text-charcoal-soft transition-colors hover:text-tomato " +
                    (slotAssignments.length === 0 ? "" : "hover-reveal")
                  }
                >
                  <Plus size={13} /> Add
                </button>
              </div>

              {slotAssignments.length === 0 ? (
                <button
                  type="button"
                  onClick={() => onAddMeal(day, slot)}
                  className="w-full rounded-xl border border-dashed border-cream-deep py-3 text-xs text-charcoal-soft transition-colors hover:border-tomato-soft hover:text-tomato"
                >
                  Nothing planned
                </button>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {slotAssignments.map((a) => {
                    const macros = assignmentMacros(a, dishes);
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => onOpenMeal(a)}
                          className="w-full rounded-xl border border-cream-deep bg-white px-3 py-2.5 text-left transition-colors hover:border-tomato-soft hover:bg-tomato/5"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                            <span className="font-600 text-charcoal">
                              {assignmentName(a, dishes)}
                              {a.servings !== 1 && (
                                <span className="ml-1.5 text-xs font-500 text-charcoal-soft">
                                  ×{a.servings}
                                </span>
                              )}
                              {isOrphaned(a, dishes) && (
                                <AlertTriangle
                                  size={13}
                                  className="ml-1 inline text-gold"
                                  aria-label="Original dish deleted"
                                />
                              )}
                            </span>
                            {showPrices && (
                              <span className="text-xs font-600 tabular-nums text-charcoal-soft">
                                {formatPrice(assignmentPrice(a, dishes))}
                              </span>
                            )}
                          </div>
                          <MacroChips macros={macros} className="mt-1" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {/* Day summary */}
      <section className="mt-5 rounded-xl2 border border-cream-deep bg-white/60 p-4">
        <h3 className="mb-3 font-display text-base font-700 text-charcoal">
          Day total
        </h3>
        <MacroSummary macros={totals} />
        {plan.targets && (
          <div className="mt-4 border-t border-cream-deep pt-4">
            <h4 className="mb-2 text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
              Against daily target
            </h4>
            <TargetAdherence actual={totals} targets={plan.targets} />
          </div>
        )}
      </section>
    </div>
  );
}
