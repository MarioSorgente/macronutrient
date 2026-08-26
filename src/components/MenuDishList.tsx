"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { categoryLabel, menuNotes, menuRecipes } from "@/lib/database";
import { formatIdr } from "@/lib/pricing";
import type { MenuRecipe } from "@/types/nutrition";

/**
 * Negrita's menu, grouped the way the restaurant groups it.
 *
 * Shared by the builder's template picker and the planner's add-to-slot dialog
 * so the two cannot drift: the same dishes, the same prices, and the same
 * published macros whether you are loading a dish to tweak or putting one
 * straight into Tuesday.
 */
export default function MenuDishList({
  query,
  onChoose,
  showSectionNotes = true,
}: {
  query: string;
  onChoose: (recipe: MenuRecipe) => void;
  /** The measurement caveats, which only the builder has room for. */
  showSectionNotes?: boolean;
}) {
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = menuRecipes.filter((recipe) =>
      q ? recipe.name.toLowerCase().includes(q) : true
    );
    const map = new Map<string, MenuRecipe[]>();
    for (const recipe of filtered) {
      const arr = map.get(recipe.section) ?? [];
      arr.push(recipe);
      map.set(recipe.section, arr);
    }
    return Array.from(map.entries());
  }, [query]);

  if (!grouped.length) {
    return (
      <p className="py-8 text-center text-sm text-charcoal-soft">
        No menu dishes match “{query}”.
      </p>
    );
  }

  return (
    <>
      {grouped.map(([section, recipes]) => (
        <div key={section} className="mb-4 last:mb-0">
          <h4 className="mb-1 text-[11px] font-700 uppercase tracking-[0.14em] text-tomato">
            {categoryLabel(section)}
          </h4>
          {showSectionNotes && menuNotes.forSection(section) && (
            <p className="mb-1.5 text-[11px] leading-snug text-charcoal-soft">
              {menuNotes.forSection(section)}
            </p>
          )}
          <ul className="flex flex-col gap-1.5">
            {recipes.map((recipe) => (
              <li key={recipe.recipe_id}>
                <button
                  type="button"
                  onClick={() => onChoose(recipe)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-cream-deep bg-white px-3 py-2.5 text-left transition-colors hover:border-tomato-soft hover:bg-tomato/5"
                >
                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-600 text-charcoal">
                        {recipe.name}
                      </span>
                      {typeof recipe.price_idr === "number" && (
                        <span className="shrink-0 text-[11px] font-700 tabular-nums text-tomato">
                          {formatIdr(recipe.price_idr)}
                        </span>
                      )}
                    </div>
                    {recipe.description && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-charcoal-soft">
                        {recipe.description}
                      </p>
                    )}
                    <div className="mt-0.5 text-[11px] text-charcoal-soft">
                      {recipe.components.length} ingredient
                      {recipe.components.length === 1 ? "" : "s"}
                      {typeof recipe.menu_macros_per_serving.energy_kcal === "number" && (
                        <>
                          {" · "}
                          {/* Calories carry the same weight as the price when
                              choosing a dish, so they are read in the same way. */}
                          <span className="font-700 tabular-nums text-tomato">
                            {recipe.menu_macros_per_serving.energy_kcal} kcal
                          </span>
                          {" (menu)"}
                        </>
                      )}
                    </div>
                  </div>
                  {!recipe.quantity_complete && (
                    <span
                      className="flex shrink-0 items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-600 text-gold"
                      title="Some quantities are not stated on the menu — set them after loading."
                    >
                      <AlertTriangle size={11} /> set grams
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
