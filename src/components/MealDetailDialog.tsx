"use client";

import { AlertTriangle, Minus, Plus, Trash2 } from "lucide-react";
import type { Assignment, Dish } from "@/lib/storage/types";
import {
  assignmentBasePrice,
  assignmentItems,
  assignmentMacros,
  assignmentName,
  assignmentPrice,
  isOrphaned,
} from "@/lib/clients";
import { getIngredient } from "@/lib/database";
import { perItemMacros } from "@/lib/calc";
import { formatIdr, formatPrice } from "@/lib/pricing";
import { formatMacroGrams, round0 } from "@/lib/format";
import MacroSummary from "@/components/MacroSummary";
import Modal from "@/components/ui/Modal";

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
  locked = false,
  onRemove,
  onClose,
}: {
  assignment: Assignment;
  dishes: Map<string, Dish>;
  /** e.g. "Breakfast · Monday, Aug 17" */
  contextLabel: string;
  onChangeServings: (servings: number) => void;
  /** The kitchen already has this week: it can be read, not changed. */
  locked?: boolean;
  onRemove: () => void;
  onClose: () => void;
}) {
  const macros = assignmentMacros(assignment, dishes);
  const price = assignmentPrice(assignment, dishes);
  const base = assignmentBasePrice(assignment, dishes);
  const items = assignmentItems(assignment, dishes);
  const orphan = isOrphaned(assignment, dishes);
  const name = assignmentName(assignment, dishes);

  const priced = base.complete && base.totalIdr > 0;

  return (
    <Modal
      title={name}
      subtitle={contextLabel}
      onClose={onClose}
      footer={
        <>
          {locked ? (
            // The kitchen has this week; taking a meal out here would change
            // nothing it is cooking, and would hide what was actually ordered.
            <span className="mr-auto text-xs font-600 text-charcoal-soft">
              With the kitchen — cancel the order to change this week.
            </span>
          ) : (
            <button
              type="button"
              onClick={onRemove}
              className="mr-auto flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-600 text-charcoal-soft hover:text-tomato-dark"
            >
              <Trash2 size={15} /> Remove from plan
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
          >
            Done
          </button>
        </>
      }
    >
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
                disabled={locked}
                className="grid h-8 w-8 place-items-center rounded-l-lg text-charcoal-soft hover:bg-cream-deep disabled:cursor-not-allowed disabled:opacity-40"
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
                disabled={locked}
                className="grid h-8 w-8 place-items-center rounded-r-lg text-charcoal-soft hover:bg-cream-deep disabled:cursor-not-allowed disabled:opacity-40"
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

            {priced ? (
              <p className="mt-1 text-[11px] text-charcoal-soft">
                {assignment.servings !== 1 && (
                  <>
                    {formatIdr(base.totalIdr)} × {assignment.servings} servings.{" "}
                  </>
                )}
                Negrita menu price.
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-charcoal-soft">
                Some ingredients are not sold as DIY components, so this is a
                minimum rather than the full price.
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
                          {contributed ? formatMacroGrams(contributed.protein_g) : "—"}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-charcoal-soft">
                          {contributed ? formatMacroGrams(contributed.carbs_g) : "—"}
                        </td>
                        <td className="py-1.5 pl-2 text-right tabular-nums text-charcoal-soft">
                          {contributed ? formatMacroGrams(contributed.fat_g) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
    </Modal>
  );
}
