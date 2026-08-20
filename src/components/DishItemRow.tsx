"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import type { DishItem } from "@/lib/storage/types";
import { getIngredient, categoryLabel } from "@/lib/database";
import { perItemMacros } from "@/lib/calc";
import { grams as fmtGrams, round0, round1 } from "@/lib/format";

const STEP = 10;

export default function DishItemRow({
  item,
  onSetGrams,
  onRemove,
}: {
  item: DishItem;
  onSetGrams: (grams: number) => void;
  onRemove: () => void;
}) {
  const ingredient = getIngredient(item.ingredientId);
  const [draft, setDraft] = useState<string>(fmtGrams(item.grams));

  // Keep the field in sync when grams change from elsewhere (e.g. steppers).
  useEffect(() => {
    setDraft(fmtGrams(item.grams));
  }, [item.grams]);

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

  const contributed = perItemMacros(ingredient, item.grams);
  const commit = (raw: string) => {
    const n = parseFloat(raw);
    onSetGrams(Number.isFinite(n) && n >= 0 ? n : 0);
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

      <div className="mt-2 flex items-center justify-between gap-3">
        {/* Grams stepper */}
        <div className="flex items-center rounded-lg border border-cream-deep bg-white">
          <button
            type="button"
            onClick={() => onSetGrams(Math.max(0, item.grams - STEP))}
            className="grid h-8 w-8 place-items-center rounded-l-lg text-charcoal-soft hover:bg-cream-deep"
            aria-label="Decrease grams"
          >
            <Minus size={14} />
          </button>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            className="no-spin w-16 border-x border-cream-deep bg-white py-1 text-center text-sm font-600 tabular-nums text-charcoal outline-none"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            aria-label={`Grams of ${ingredient.name}`}
          />
          <button
            type="button"
            onClick={() => onSetGrams(item.grams + STEP)}
            className="grid h-8 w-8 place-items-center rounded-r-lg text-charcoal-soft hover:bg-cream-deep"
            aria-label="Increase grams"
          >
            <Plus size={14} />
          </button>
          <span className="px-2 text-xs font-600 text-charcoal-soft">g</span>
        </div>

        {/* Contribution */}
        <div className="flex items-center gap-3 text-[11px] tabular-nums text-charcoal-soft">
          <span>
            <b className="font-700 text-tomato">{round0(contributed.energy_kcal)}</b>{" "}
            kcal
          </span>
          <span>P {round1(contributed.protein_g)}</span>
          <span>C {round1(contributed.carbs_g)}</span>
          <span>F {round1(contributed.fat_g)}</span>
        </div>
      </div>
    </li>
  );
}
