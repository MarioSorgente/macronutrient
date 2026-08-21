"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import type { DishItem } from "@/lib/storage/types";
import { getIngredient, categoryLabel } from "@/lib/database";
import { perItemMacros } from "@/lib/calc";
import { findUnit, normalizeQuantity, stepFor, unitsFor } from "@/lib/units";
import { GRAM_UNIT_ID } from "@/types/nutrition";
import { grams as fmtGrams, round0 } from "@/lib/format";
import MacroChips from "@/components/MacroChips";

export default function DishItemRow({
  item,
  onSetQuantity,
  onSetUnit,
  onRemove,
}: {
  item: DishItem;
  onSetQuantity: (quantity: number) => void;
  onSetUnit: (unitId: string) => void;
  onRemove: () => void;
}) {
  const ingredient = getIngredient(item.ingredientId);
  const [draft, setDraft] = useState<string>(fmtGrams(item.quantity));

  // Keep the field in sync when the amount changes elsewhere (steppers, units).
  useEffect(() => {
    setDraft(fmtGrams(item.quantity));
  }, [item.quantity, item.unitId]);

  if (!ingredient) {
    return (
      <li className="rounded-xl border border-tomato-soft bg-tomato-soft/10 px-3 py-2.5 text-sm text-tomato-dark">
        Unknown ingredient: {item.name || item.ingredientId}
        <button onClick={onRemove} className="ml-2 underline">
          remove
        </button>
      </li>
    );
  }

  const units = unitsFor(ingredient);
  const unit = findUnit(ingredient, item.unitId);
  const step = stepFor(unit);
  const contributed = perItemMacros(ingredient, item.grams);
  const showGramHint = unit.id !== GRAM_UNIT_ID;

  const commit = (raw: string) => {
    const parsed = parseFloat(raw);
    const next = normalizeQuantity(unit, Number.isFinite(parsed) ? parsed : 0);
    // Snap the field to the value actually stored, so a rejected fraction on a
    // countable unit ("2.4 eggs") visibly becomes the whole number we kept.
    setDraft(fmtGrams(next));
    onSetQuantity(next);
  };

  return (
    <li className="rounded-xl border border-cream-deep bg-cream px-3 py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-600 text-charcoal">{ingredient.name}</div>
          <div className="text-[11px] uppercase tracking-wide text-charcoal-soft">
            {categoryLabel(ingredient.category)}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-lg p-1.5 text-charcoal-soft hover:bg-tomato-soft/30 hover:text-tomato-dark"
          aria-label={`Remove ${ingredient.name}`}
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* Amount stepper */}
          <div className="flex items-center rounded-lg border border-cream-deep bg-white">
            <button
              type="button"
              onClick={() => onSetQuantity(Math.max(0, item.quantity - step))}
              className="grid h-8 w-8 place-items-center rounded-l-lg text-charcoal-soft hover:bg-cream-deep"
              aria-label="Decrease amount"
            >
              <Minus size={14} />
            </button>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={step}
              className="no-spin w-14 border-x border-cream-deep bg-white py-1 text-center text-sm font-600 tabular-nums text-charcoal outline-none"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              aria-label={`Amount of ${ingredient.name}`}
            />
            <button
              type="button"
              onClick={() => onSetQuantity(item.quantity + step)}
              className="grid h-8 w-8 place-items-center rounded-r-lg text-charcoal-soft hover:bg-cream-deep"
              aria-label="Increase amount"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Unit selector — only when the ingredient has more than grams. */}
          {units.length > 1 ? (
            <select
              value={item.unitId}
              onChange={(e) => onSetUnit(e.target.value)}
              className="max-w-[9.5rem] truncate rounded-lg border border-cream-deep bg-white px-2 py-1.5 text-xs font-600 text-charcoal outline-none focus:border-tomato-soft"
              aria-label={`Unit for ${ingredient.name}`}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs font-600 text-charcoal-soft">g</span>
          )}

          {showGramHint && (
            <span className="text-[11px] tabular-nums text-charcoal-soft">
              = {round0(item.grams)} g
            </span>
          )}
        </div>

        {/* Contribution */}
        <MacroChips macros={contributed} size="xxs" />
      </div>
    </li>
  );
}
