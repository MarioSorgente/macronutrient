import { Check, Plus } from "lucide-react";
import type { Ingredient } from "@/types/nutrition";
import { GRAM_UNIT_ID } from "@/types/nutrition";
import { categoryLabel, isEstimated, hasHouseOverride } from "@/lib/database";
import { categoryStyle } from "@/lib/categoryStyle";
import { macroEnergySplit } from "@/lib/calc";
import { findUnit } from "@/lib/units";
import { formatMacroGrams, round0 } from "@/lib/format";

/** Splits text on the query so matches can be visually emphasised. */
function highlight(text: string, tokens: string[]) {
  if (!tokens.length) return text;
  const pattern = new RegExp(
    `(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "ig"
  );
  return text.split(pattern).map((part, i) =>
    tokens.some((t) => part.toLowerCase() === t.toLowerCase()) ? (
      <mark key={i} className="rounded bg-gold/30 text-charcoal">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export default function IngredientRow({
  ingredient,
  inDish,
  tokens,
  isActive,
  onAdd,
}: {
  ingredient: Ingredient;
  inDish: boolean;
  tokens: string[];
  isActive?: boolean;
  onAdd: (ingredient: Ingredient) => void;
}) {
  const m = ingredient.macros_per_100g;
  const split = macroEnergySplit(m);
  const { icon: Icon, tone } = categoryStyle(ingredient.category);
  const defaultUnit = findUnit(ingredient, ingredient.defaultUnitId);
  const showsUnit = defaultUnit.id !== GRAM_UNIT_ID;
  const estimated = isEstimated(ingredient) && !hasHouseOverride(ingredient.ingredient_id);

  return (
    <li
      className={
        "group flex items-center gap-3 rounded-xl border bg-cream px-3 py-2.5 transition-colors " +
        (isActive
          ? "border-tomato ring-2 ring-tomato-soft/40"
          : "border-cream-deep hover:border-tomato-soft")
      }
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tone}`}>
        <Icon size={17} strokeWidth={2.1} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-600 text-charcoal">
            {highlight(ingredient.name, tokens)}
          </span>
          {estimated && (
            <span
              className="shrink-0 rounded bg-gold/15 px-1.5 py-0.5 text-[9px] font-700 uppercase tracking-wide text-gold"
              title="Estimated value — define the house recipe to make it exact."
            >
              est
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-charcoal-soft">
          <span className="font-600 uppercase tracking-wide opacity-80">
            {categoryLabel(ingredient.category)}
          </span>
          <span className="tabular-nums">
            <b className="font-700 text-tomato">{round0(m.energy_kcal)}</b> kcal
          </span>
          <span className="tabular-nums">P {formatMacroGrams(m.protein_g)}</span>
          <span className="tabular-nums">C {formatMacroGrams(m.carbs_g)}</span>
          <span className="tabular-nums">F {formatMacroGrams(m.fat_g)}</span>
          <span className="opacity-60">/100 g</span>
          {showsUnit && (
            <span className="rounded bg-cream-deep px-1.5 py-0.5 font-600 text-charcoal-soft">
              1 {defaultUnit.label} = {round0(defaultUnit.gramWeight)} g
            </span>
          )}
        </div>

        {/* Macro composition at a glance */}
        <div className="mt-1.5 flex h-1 w-full max-w-[16rem] overflow-hidden rounded-full bg-cream-deep">
          <span className="bg-basil" style={{ width: `${split.proteinPct}%` }} />
          <span className="bg-gold" style={{ width: `${split.carbsPct}%` }} />
          <span className="bg-tomato-dark" style={{ width: `${split.fatPct}%` }} />
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
