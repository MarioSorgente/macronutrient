"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Printer, UtensilsCrossed } from "lucide-react";
import { getClientRepository, getDishRepository } from "@/lib/storage";
import type { Client, Dish } from "@/lib/storage/types";
import {
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
import { databaseMeta } from "@/lib/database";
import { formatDate, round0, round1 } from "@/lib/format";
import MacroSummary from "@/components/MacroSummary";
import TargetAdherence from "@/components/TargetAdherence";

export default function ClientReport() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [client, setClient] = useState<Client | null>(null);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"all" | number>("all");

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

  const dishMap = useMemo(() => new Map(dishes.map((d) => [d.id, d])), [dishes]);

  if (loading) {
    return <Centered>Loading report…</Centered>;
  }

  if (!client) {
    return (
      <Centered>
        <p className="font-display text-xl font-700 text-charcoal">
          Client not found
        </p>
        <Link
          href="/clients"
          className="mt-4 inline-flex rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
        >
          Back to clients
        </Link>
      </Centered>
    );
  }

  const weeks =
    scope === "all"
      ? Array.from({ length: client.weekCount }, (_, i) => i + 1)
      : [scope];

  return (
    <div className="min-h-screen">
      {/* Action bar (hidden when printing) */}
      <div className="no-print sticky top-0 z-10 border-b border-cream-deep bg-cream/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link
            href={`/clients/${client.id}`}
            className="flex items-center gap-1.5 text-sm font-600 text-charcoal-soft hover:text-charcoal"
          >
            <ArrowLeft size={16} /> Back to planner
          </Link>
          <div className="flex items-center gap-2">
            <select
              value={scope === "all" ? "all" : String(scope)}
              onChange={(e) =>
                setScope(e.target.value === "all" ? "all" : Number(e.target.value))
              }
              className="rounded-lg border border-cream-deep bg-white px-2.5 py-1.5 text-sm font-600 text-charcoal outline-none focus:border-tomato-soft"
              aria-label="Report scope"
            >
              <option value="all">Whole program</option>
              {Array.from({ length: client.weekCount }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  Week {w} only
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-2 rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
            >
              <Printer size={16} /> Print / Save as PDF
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <article className="print-page rounded-xl2 border border-cream-deep bg-white p-6 shadow-card sm:p-8">
          {/* Brand header */}
          <div className="flex items-center justify-between border-b border-cream-deep pb-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl2 bg-tomato text-cream">
                <UtensilsCrossed size={20} />
              </span>
              <div className="leading-tight">
                <div className="font-display text-lg font-700 text-charcoal">
                  Mamma Calories
                </div>
                <div className="text-[11px] font-600 uppercase tracking-[0.18em] text-tomato">
                  For Negrita
                </div>
              </div>
            </div>
            <div className="text-right text-xs text-charcoal-soft">
              <div>Client meal plan</div>
              <div>{formatDate(client.updatedAt)}</div>
            </div>
          </div>

          {/* Client */}
          <div className="py-5">
            <h1 className="font-display text-3xl font-700 text-charcoal">
              {client.name}
            </h1>
            <p className="mt-1 text-sm text-charcoal-soft">
              {scope === "all"
                ? `${client.weekCount}-week program`
                : `Week ${scope}`}{" "}
              · starts {formatShortDate(dateFor(client, 1, 0))}
            </p>
            {client.notes && (
              <p className="mt-2 rounded-lg bg-cream px-3 py-2 text-sm text-charcoal-soft">
                {client.notes}
              </p>
            )}
          </div>

          {weeks.map((week) => {
            const totals = weekTotals(client, week, dishMap);
            const average = weekDailyAverage(client, week, dishMap);
            const hasAny = assignmentsFor(client, week).length > 0;

            return (
              <section
                key={week}
                className="mb-8 border-t border-cream-deep pt-5 last:mb-0"
              >
                <h2 className="font-display text-xl font-700 text-charcoal">
                  Week {week}
                </h2>
                <p className="mb-3 text-xs text-charcoal-soft">
                  {formatShortDate(dateFor(client, week, 0))} –{" "}
                  {formatShortDate(dateFor(client, week, 6))}
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
                          {formatPrice(weekPrice(client, week, dishMap))}
                        </b>
                      </span>
                      <span className="text-charcoal-soft">
                        Average per day{" "}
                        <b className="tabular-nums text-charcoal">
                          {formatIdr(
                            weekPrice(client, week, dishMap).totalIdr / 7
                          )}
                        </b>
                      </span>
                      {!weekPrice(client, week, dishMap).complete && (
                        <span className="text-gold">
                          Some items are not sold as DIY components, so the total
                          is a minimum.
                        </span>
                      )}
                    </div>

                    {client.targets && (
                      <div className="mt-4">
                        <h3 className="mb-2 text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
                          Daily average vs target
                        </h3>
                        <TargetAdherence
                          actual={average}
                          targets={client.targets}
                        />
                      </div>
                    )}

                    {/* Day-by-day */}
                    <div className="mt-5 space-y-3">
                      {DAY_NAMES.map((dayName, dayIndex) => {
                        const dayAssignments = assignmentsFor(
                          client,
                          week,
                          dayIndex
                        );
                        if (!dayAssignments.length) return null;
                        const dTotals = dayTotals(client, week, dayIndex, dishMap);

                        return (
                          <div
                            key={dayIndex}
                            className="break-inside-avoid rounded-lg border border-cream-deep"
                          >
                            <div className="flex items-baseline justify-between border-b border-cream-deep bg-cream px-3 py-1.5">
                              <span className="text-sm font-700 text-charcoal">
                                {dayName}
                                <span className="ml-2 text-[11px] font-500 text-charcoal-soft">
                                  {formatShortDate(dateFor(client, week, dayIndex))}
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
                                  dayPrice(client, week, dayIndex, dishMap)
                                )}
                              </span>
                            </div>
                            <ul className="divide-y divide-cream-deep/60">
                              {client.mealSlots.flatMap((slot) => {
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

          <p className="mt-6 border-t border-cream-deep pt-4 text-[11px] leading-relaxed text-charcoal-soft">
            Macros are calculated from each ingredient&apos;s per-100&nbsp;g values as{" "}
            <span className="font-600">grams ÷ 100 × value per 100&nbsp;g</span>.
            Source: {databaseMeta.name} (v{databaseMeta.version}). Some restaurant
            values are estimates; define house recipes to make them exact.
          </p>
        </article>
      </main>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="text-center text-charcoal-soft">{children}</div>
    </div>
  );
}
