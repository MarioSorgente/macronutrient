"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Pencil, TriangleAlert } from "lucide-react";
import type { Ingredient } from "@/types/nutrition";
import { getIngredient, nutritionCatalog, isEstimated } from "@/lib/database";
import { categoryStyle } from "@/lib/categoryStyle";
import { useHouseRecipes } from "@/store/houseRecipes";
import HouseRecipeEditor from "@/components/HouseRecipeEditor";
import { round0 } from "@/lib/format";
import MacroChips from "@/components/MacroChips";

export default function HouseItemList() {
  const version = useHouseRecipes((s) => s.version);
  const loaded = useHouseRecipes((s) => s.loaded);
  const getRecipeFor = useHouseRecipes((s) => s.getRecipeFor);
  const [editing, setEditing] = useState<Ingredient | null>(null);

  // Ingredients whose values are estimates with no public source to verify them.
  const estimatedItems = useMemo(
    () =>
      nutritionCatalog.ingredients
        .filter(isEstimated)
        .map((i) => getIngredient(i.ingredient_id) ?? i),
    // `version` is a cache-buster: getIngredient() resolves house overrides at
    // call time, so this must recompute when one is saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]
  );

  if (!loaded) {
    return <p className="text-sm text-charcoal-soft">Loading house items…</p>;
  }

  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2">
        {estimatedItems.map((item) => {
          const recipe = getRecipeFor(item.ingredient_id);
          const defined = Boolean(recipe);
          const { icon: Icon, tone } = categoryStyle(item.category);
          const m = item.macros_per_100g;

          return (
            <li
              key={item.ingredient_id}
              className="flex flex-col rounded-xl2 border border-cream-deep bg-white/70 p-4 shadow-card"
            >
              <div className="flex items-start gap-3">
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${tone}`}
                >
                  <Icon size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-base font-700 leading-tight text-charcoal">
                    {item.name}
                  </h3>
                  <span
                    className={
                      "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-700 uppercase tracking-wide " +
                      (defined
                        ? "bg-basil/15 text-basil"
                        : "bg-gold/15 text-gold")
                    }
                  >
                    {defined ? (
                      <>
                        <CheckCircle2 size={11} /> From recipe
                      </>
                    ) : (
                      <>
                        <TriangleAlert size={11} /> Estimated
                      </>
                    )}
                  </span>
                </div>
              </div>

              <MacroChips macros={m} className="mt-3">
                <span className="opacity-70">/100 g</span>
              </MacroChips>

              {recipe && (
                <p className="mt-2 text-[11px] text-charcoal-soft">
                  {recipe.components.length} ingredient
                  {recipe.components.length === 1 ? "" : "s"} · batch yield{" "}
                  {round0(recipe.yieldGrams)} g
                </p>
              )}

              <button
                type="button"
                onClick={() => setEditing(item)}
                className="mt-4 flex items-center justify-center gap-1.5 rounded-lg border border-cream-deep bg-cream px-3 py-2 text-sm font-600 text-charcoal hover:border-tomato-soft"
              >
                <Pencil size={14} />
                {defined ? "Edit recipe" : "Define recipe"}
              </button>
            </li>
          );
        })}
      </ul>

      {editing && (
        <HouseRecipeEditor
          ingredient={editing}
          existing={getRecipeFor(editing.ingredient_id)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
