"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Minus, Plus, RotateCcw, Trash2, X } from "lucide-react";
import type { Assignment, Dish } from "@/lib/storage/types";
import {
  assignmentBasePrice,
  assignmentItems,
  assignmentMacros,
  assignmentName,
  assignmentPrice,
  clampMarkUp,
  isOrphaned,
} from "@/lib/clients";
import { getIngredient } from "@/lib/database";
import { perItemMacros } from "@/lib/calc";
import { formatIdr, formatPrice } from "@/lib/pricing";
import { round0, round1 } from "@/lib/format";
import MacroSummary from "@/components/MacroSummary";

/**
 * Everything about one planned meal: what it is, what it delivers, what it
 * costs, and what is actually in it — plus the edits that belong at meal level
 * (servings, mark-up, removal).
 */
export default function MealDetailDialog({
  assignment,
  dishes,
  contextLabel,
  onChangeServings,
  onChangeMarkUp,
  onRemove,
  onClose,
}: {
  assignment: Assignment;
  dishes: Map<string, Dish>;
  /** e.g. "Breakfast · Monday, Aug 17" */
  contextLabel: string;
  onChangeServings: (servings: number) => void;
  onChangeMarkUp: (priceIdr: number | undefined) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const macros = assignmentMacros(assignment, dishes);
  const price = assignmentPrice(assignment, dishes);
  const base = assignmentBasePrice(assignment, dishes);
  const items = assignmentItems(assignment, dishes);
  const orphan = isOrphaned(assignment, dishes);
  const name = assignmentName(assignment, dishes);

  // A mark-up needs a known menu price to sit above; without one there is no
  // floor to enforce, so the field is not offered.
  const canMarkUp = base.complete && base.totalIdr > 0;
  const currentUnit =
    typeof assignment.priceOverrideIdr === "number"
      ? Math.max(assignment.priceOverrideIdr, base.totalIdr)
      : base.totalIdr;
  const markedUp = currentUnit > base.totalIdr;

  const [draft, setDraft] = useState(String(currentUnit));
  useEffect(() => setDraft(String(currentUnit)), [currentUnit]);

  function commitMarkUp(raw: string) {
    const parsed = parseFloat(raw.replace(/[^\d.]/g, ""));
    const next = clampMarkUp(parsed, base.totalIdr);
    // Snap the field to what is actually stored, so a rejected lower figure is
    // visibly corrected rather than silently ignored.
    setDraft(String(next));
    onChangeMarkUp(next > base.totalIdr ? next : undefined);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-charcoal/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl2 bg-cream shadow-card sm:rounded-xl2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-cream-deep px-4 py-3">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-700 leading-tight text-charcoal">
              {name}
            </h3>
            <p className="mt-0.5 text-xs text-charcoal-soft">{contextLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-charcoal-soft hover:bg-cream-deep"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="scroll-slim flex-1 overflow-y-auto px-4 py-4">
          <MacroSummary macros={macros} />

          {/* Servings */}
          <div className="mt-4 flex items-center justify-between rounded-xl border border-cream-deep bg-white px-3 py-2.5">
            <span className="text-sm font-600 text-charcoal">Servings</span>
            <div className="flex items-center rounded-lg border border-cream-deep">
              <button
                type="button"
                onClick={() =>
                  onChangeServings(Math.max(0.5, assignment.servings - 0.5))
                }
                className="grid h-8 w-8 place-items-center rounded-l-lg text-charcoal-soft hover:bg-cream-deep"
                aria-label="Fewer servings"
              >
                <Minus size={14} />
              </button>
              <span className="w-12 border-x border-cream-deep py-1 text-center text-sm font-600 tabular-nums">
                {assignment.servings}
              </span>
              <button
                type="button"
                onClick={() => onChangeServings(assignment.servings + 0.5)}
                className="grid h-8 w-8 place-items-center rounded-r-lg text-charcoal-soft hover:bg-cream-deep"
                aria-label="More servings"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Price — the total leads, so it visibly moves with servings. */}
          <div className="mt-2 rounded-xl border border-cream-deep bg-white px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-600 text-charcoal">Price</span>
              <span className="font-display text-xl font-700 tabular-nums text-charcoal">
                {formatPrice(price)}
              </span>
            </div>

            {canMarkUp ? (
              <>
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-cream-deep pt-2">
                  <span className="text-xs font-600 text-charcoal-soft">
                    Per serving
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-charcoal-soft">Rp</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={(e) => commitMarkUp(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className="w-28 rounded-lg border border-cream-deep px-2 py-1 text-right text-sm font-600 tabular-nums outline-none focus:border-tomato-soft"
                      aria-label="Price per serving"
                    />
                    {markedUp && (
                      <button
                        type="button"
                        onClick={() => onChangeMarkUp(undefined)}
                        className="rounded-lg p-1.5 text-charcoal-soft hover:text-tomato-dark"
                        title="Reset to menu price"
                        aria-label="Reset to menu price"
                      >
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <p className="mt-1 text-[11px] text-charcoal-soft">
                  {assignment.servings !== 1 && (
                    <>
                      {formatIdr(currentUnit)} × {assignment.servings} servings.{" "}
                    </>
                  )}
                  {markedUp ? (
                    <>
                      Marked up from the menu price of{" "}
                      <b className="text-charcoal">{formatIdr(base.totalIdr)}</b>.
                    </>
                  ) : (
                    <>Menu price. It can be raised, but not lowered.</>
                  )}
                </p>
              </>
            ) : (
              <p className="mt-1 text-[11px] text-charcoal-soft">
                Some ingredients are not sold as DIY components, so there is no
                menu price to mark up.
              </p>
            )}
          </div>

          {/* Ingredients */}
          <h4 className="mb-2 mt-4 text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
            Ingredients
          </h4>

          {orphan || !items ? (
            <p className="flex items-start gap-2 rounded-xl bg-gold/10 px-3 py-2.5 text-xs text-charcoal">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-gold" />
              The saved dish behind this meal was deleted, so its ingredient list
              is gone. The totals above come from the snapshot taken when it was
              planned.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[22rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-cream-deep text-left text-[11px] uppercase tracking-wide text-charcoal-soft">
                    <th className="py-1.5 pr-2 font-600">Ingredient</th>
                    <th className="py-1.5 px-2 text-right font-600">Grams</th>
                    <th className="py-1.5 px-2 text-right font-600">kcal</th>
                    <th className="py-1.5 px-2 text-right font-600">P</th>
                    <th className="py-1.5 px-2 text-right font-600">C</th>
                    <th className="py-1.5 pl-2 text-right font-600">F</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const ingredient = getIngredient(item.ingredientId);
                    const contributed = ingredient
                      ? perItemMacros(ingredient, item.grams * assignment.servings)
                      : null;
                    return (
                      <tr
                        key={item.ingredientId}
                        className="border-b border-cream-deep/60"
                      >
                        <td className="py-1.5 pr-2 text-charcoal">
                          {ingredient?.name ?? item.name}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-charcoal-soft">
                          {round0(item.grams * assignment.servings)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-600 tabular-nums text-tomato">
                          {contributed ? round0(contributed.energy_kcal) : "—"}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-charcoal-soft">
                          {contributed ? round1(contributed.protein_g) : "—"}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-charcoal-soft">
                          {contributed ? round1(contributed.carbs_g) : "—"}
                        </td>
                        <td className="py-1.5 pl-2 text-right tabular-nums text-charcoal-soft">
                          {contributed ? round1(contributed.fat_g) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-cream-deep px-4 py-3">
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-600 text-charcoal-soft hover:text-tomato-dark"
          >
            <Trash2 size={15} /> Remove from plan
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
