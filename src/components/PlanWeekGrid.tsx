"use client";

import { AlertTriangle, Plus } from "lucide-react";
import type { Assignment, Client, Dish } from "@/lib/storage/types";
import {
  DAY_SHORT,
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
import { round0 } from "@/lib/format";

/**
 * Seven-day overview. Kept deliberately sparse: a meal shows its name and
 * calories, and everything else lives one click away in the meal dialog.
 */
export default function PlanWeekGrid({
  client,
  week,
  dishes,
  showPrices,
  onOpenMeal,
  onAddMeal,
}: {
  client: Client;
  week: number;
  dishes: Map<string, Dish>;
  showPrices: boolean;
  onOpenMeal: (assignment: Assignment) => void;
  onAddMeal: (day: number, slot: string) => void;
}) {
  return (
    <div className="scroll-slim -mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      <div className="grid min-w-[52rem] grid-cols-7 gap-2">
        {DAY_SHORT.map((dayName, dayIndex) => {
          const totals = dayTotals(client, week, dayIndex, dishes);
          const price = dayPrice(client, week, dayIndex, dishes);
          const date = dateFor(client, week, dayIndex);

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
                {client.mealSlots.map((slot) => {
                  const slotAssignments = assignmentsFor(
                    client,
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
                        className={
                          "mt-1 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-cream-deep py-1 text-[10px] font-600 text-charcoal-soft transition-colors hover:border-tomato-soft hover:text-tomato " +
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

              <div className="mt-2 border-t border-cream-deep pt-1.5 text-center">
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
                {client.targets && (
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-cream-deep">
                    <span
                      className="block h-full bg-tomato"
                      style={{
                        width: `${Math.min(
                          100,
                          (totals.energy_kcal / client.targets.energy_kcal) * 100
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
  );
}
