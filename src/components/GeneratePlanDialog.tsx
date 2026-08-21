"use client";

import { useMemo, useState } from "react";
import { RefreshCw, Sparkles, Wallet, X } from "lucide-react";
import type { Client, Dish, MacroTargets } from "@/lib/storage/types";
import { TARGET_FIELDS, DAY_SHORT } from "@/lib/clients";
import { generatePlan, type GeneratedDay } from "@/lib/mealPlanner";
import { formatIdr, formatPrice } from "@/lib/pricing";
import { round0, round1 } from "@/lib/format";

const DEFAULT_TARGETS: MacroTargets = {
  energy_kcal: 2000,
  protein_g: 150,
  carbs_g: 200,
  fat_g: 65,
};

/**
 * Coach workflow: set the targets, generate a week of meals from what Negrita
 * sells, review it (with cost), then write it into the client's plan.
 * Nothing is saved until the coach accepts.
 */
export default function GeneratePlanDialog({
  client,
  week,
  savedDishes,
  onApply,
  onClose,
}: {
  client: Client;
  week: number;
  savedDishes: Dish[];
  onApply: (days: GeneratedDay[], replace: boolean) => void;
  onClose: () => void;
}) {
  const [targets, setTargets] = useState<MacroTargets>(
    client.targets ?? DEFAULT_TARGETS
  );
  const [includeReady, setIncludeReady] = useState(true);
  const [budgetOn, setBudgetOn] = useState(false);
  const [budget, setBudget] = useState(250000);
  const [replace, setReplace] = useState(true);
  const [seed, setSeed] = useState(1);
  const [preview, setPreview] = useState<GeneratedDay[] | null>(null);

  const days = useMemo(() => [0, 1, 2, 3, 4, 5, 6], []);

  function run(nextSeed: number) {
    setSeed(nextSeed);
    setPreview(
      generatePlan({
        targets,
        slots: client.mealSlots,
        includeReadyDishes: includeReady,
        savedDishes,
        dailyBudgetIdr: budgetOn ? budget : null,
        days,
        seed: nextSeed,
      })
    );
  }

  const weekPrice = preview?.reduce((sum, d) => sum + d.price.totalIdr, 0) ?? 0;
  const avgDay = preview?.length
    ? preview.reduce((s, d) => s + d.macros.energy_kcal, 0) / preview.length
    : 0;
  const avgProtein = preview?.length
    ? preview.reduce((s, d) => s + d.macros.protein_g, 0) / preview.length
    : 0;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-charcoal/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-xl2 bg-cream shadow-card sm:rounded-xl2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-cream-deep px-4 py-3">
          <div>
            <h3 className="flex items-center gap-2 font-display text-lg font-700 text-charcoal">
              <Sparkles size={18} className="text-tomato" />
              Generate week {week} for {client.name}
            </h3>
            <p className="text-xs text-charcoal-soft">
              Set the daily targets — the planner fills the week from Negrita&apos;s menu.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-charcoal-soft hover:bg-cream-deep"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="scroll-slim flex-1 overflow-y-auto px-4 py-4">
          {/* Targets */}
          <h4 className="mb-2 text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
            Daily targets
          </h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TARGET_FIELDS.map((field) => (
              <label key={field.key} className="text-xs">
                <span className="mb-1 block font-600 text-charcoal-soft">
                  {field.label} ({field.unit})
                </span>
                <input
                  type="number"
                  min={0}
                  value={targets[field.key]}
                  onChange={(e) =>
                    setTargets({
                      ...targets,
                      [field.key]: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="no-spin w-full rounded-lg border border-cream-deep bg-white px-2 py-1.5 text-sm font-600 tabular-nums outline-none focus:border-tomato-soft"
                />
              </label>
            ))}
          </div>

          {/* Options */}
          <div className="mt-4 space-y-2 rounded-xl border border-cream-deep bg-white p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeReady}
                onChange={(e) => setIncludeReady(e.target.checked)}
                className="h-4 w-4 accent-tomato"
              />
              <span className="font-600 text-charcoal">
                Also use ready menu dishes
              </span>
              <span className="text-xs text-charcoal-soft">
                (alongside built-to-order combinations)
              </span>
            </label>

            <label className="flex flex-wrap items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={budgetOn}
                onChange={(e) => setBudgetOn(e.target.checked)}
                className="h-4 w-4 accent-tomato"
              />
              <span className="flex items-center gap-1.5 font-600 text-charcoal">
                <Wallet size={14} /> Daily budget
              </span>
              {budgetOn && (
                <span className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value) || 0)}
                    className="no-spin w-28 rounded-lg border border-cream-deep px-2 py-1 text-right text-sm font-600 tabular-nums outline-none focus:border-tomato-soft"
                  />
                  <span className="text-xs text-charcoal-soft">
                    IDR / day ({formatIdr(budget)})
                  </span>
                </span>
              )}
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
                className="h-4 w-4 accent-tomato"
              />
              <span className="font-600 text-charcoal">
                Replace anything already planned this week
              </span>
            </label>
          </div>

          {/* Generate */}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => run(seed)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-tomato px-4 py-2.5 font-700 text-cream hover:bg-tomato-dark"
            >
              <Sparkles size={16} /> {preview ? "Regenerate" : "Generate plan"}
            </button>
            {preview && (
              <button
                type="button"
                onClick={() => run(seed + 1)}
                className="flex items-center justify-center gap-2 rounded-xl border border-cream-deep bg-white px-4 py-2.5 font-600 text-charcoal hover:border-tomato-soft"
              >
                <RefreshCw size={15} /> Shuffle
              </button>
            )}
          </div>

          {/* Preview */}
          {preview && (
            <div className="mt-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
                  Preview
                </h4>
                <div className="flex flex-wrap gap-3 text-xs tabular-nums text-charcoal-soft">
                  <span>
                    avg{" "}
                    <b className="text-charcoal">{round0(avgDay)}</b> kcal/day
                    <span className="ml-1 opacity-70">
                      (target {round0(targets.energy_kcal)})
                    </span>
                  </span>
                  <span>
                    avg <b className="text-charcoal">{round1(avgProtein)}</b> g P
                    <span className="ml-1 opacity-70">
                      (target {round0(targets.protein_g)})
                    </span>
                  </span>
                  <span className="font-700 text-tomato">
                    {formatIdr(weekPrice)} / week
                  </span>
                </div>
              </div>

              {/* Say plainly when constraints prevented a full plan. */}
              {preview.some((d) => d.unfilledSlots.length > 0) && (
                <p className="mb-2 rounded-lg bg-gold/10 px-3 py-2 text-xs text-charcoal">
                  Some meal slots could not be filled without going far off
                  target
                  {budgetOn ? " within this budget" : ""}, so they were left
                  empty rather than padded with something that misses the mark.
                  {budgetOn && " Raising the daily budget usually fixes it."}
                </p>
              )}

              <ul className="flex flex-col gap-2">
                {preview.map((day) => (
                  <li
                    key={day.day}
                    className="rounded-xl border border-cream-deep bg-white p-3"
                  >
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="font-display text-sm font-700 text-charcoal">
                        {DAY_SHORT[day.day]}
                      </span>
                      <span className="text-xs tabular-nums text-charcoal-soft">
                        <b className="text-tomato">
                          {round0(day.macros.energy_kcal)}
                        </b>{" "}
                        kcal · P {round1(day.macros.protein_g)} · C{" "}
                        {round1(day.macros.carbs_g)} · F {round1(day.macros.fat_g)}
                        <b className="ml-2 text-charcoal">
                          {formatPrice(day.price)}
                        </b>
                      </span>
                    </div>
                    <ul className="space-y-0.5">
                      {day.meals.map((meal, i) => (
                        <li
                          key={`${day.day}-${i}`}
                          className="flex items-baseline justify-between gap-2 text-xs"
                        >
                          <span className="min-w-0">
                            <span className="mr-1.5 text-[10px] font-700 uppercase tracking-wide text-charcoal-soft">
                              {meal.slot}
                            </span>
                            <span className="text-charcoal">{meal.name}</span>
                            {meal.kind === "ready" && (
                              <span className="ml-1 rounded bg-cream-deep px-1 text-[9px] font-700 uppercase text-charcoal-soft">
                                menu
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 tabular-nums text-charcoal-soft">
                            {round0(meal.macros.energy_kcal)} kcal ·{" "}
                            {formatPrice(meal.price)}
                          </span>
                        </li>
                      ))}
                      {day.unfilledSlots.length > 0 && (
                        <li className="pt-0.5 text-[11px] text-gold">
                          Could not fill {day.unfilledSlots.join(", ")} within the
                          constraints
                          {budgetOn ? " — try raising the daily budget." : "."}
                        </li>
                      )}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-cream-deep px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-cream-deep bg-white px-4 py-2 text-sm font-600 text-charcoal"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!preview}
            onClick={() => preview && onApply(preview, replace)}
            className="rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark disabled:opacity-50"
          >
            Apply to week {week}
          </button>
        </div>
      </div>
    </div>
  );
}
