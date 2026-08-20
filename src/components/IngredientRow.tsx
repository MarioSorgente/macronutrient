import { Check, Plus } from "lucide-react";
import type { Ingredient } from "@/types/nutrition";
import { categoryLabel } from "@/lib/database";
import { round0, round1 } from "@/lib/format";

export default function IngredientRow({
  ingredient,
  inDish,
  onAdd,
}: {
  ingredient: Ingredient;
  inDish: boolean;
  onAdd: (ingredient: Ingredient) => void;
}) {
  const m = ingredient.macros_per_100g;
  return (
    <li className="flex items-center gap-3 rounded-xl border border-cream-deep bg-cream px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate font-600 text-charcoal">{ingredient.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-charcoal-soft">
          <span className="rounded bg-cream-deep px-1.5 py-0.5 font-600 uppercase tracking-wide">
            {categoryLabel(ingredient.category)}
          </span>
          <span className="tabular-nums">
            <b className="font-700 text-tomato">{round0(m.energy_kcal)}</b> kcal
          </span>
          <span className="tabular-nums">P {round1(m.protein_g)}</span>
          <span className="tabular-nums">C {round1(m.carbs_g)}</span>
          <span className="tabular-nums">F {round1(m.fat_g)}</span>
          <span className="opacity-70">/ 100 g</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onAdd(ingredient)}
        disabled={inDish}
        className={
          "flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-600 transition-colors " +
          (inDish
            ? "cursor-default bg-basil/10 text-basil"
            : "bg-tomato text-cream hover:bg-tomato-dark")
        }
        aria-label={inDish ? `${ingredient.name} added` : `Add ${ingredient.name}`}
      >
        {inDish ? (
          <>
            <Check size={15} /> Added
          </>
        ) : (
          <>
            <Plus size={15} /> Add
          </>
        )}
      </button>
    </li>
  );
}
