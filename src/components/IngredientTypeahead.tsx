"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import type { Ingredient } from "@/types/nutrition";
import { searchIngredients } from "@/lib/database";
import { cn } from "@/components/ui/cn";

/**
 * Search-and-pick over Negrita's ingredients.
 *
 * Three dialogs each grew their own copy of this — the house-recipe editor,
 * the assign dialog's Build tab and the generator's avoid-list — with the same
 * "search, drop what is already chosen, show the top few" logic written out
 * three times. The query lives in here, so a caller only supplies what to
 * exclude and what to do with the pick.
 */
export default function IngredientTypeahead({
  placeholder,
  excludeIds,
  onSelect,
  limit = 6,
  autoFocus,
  className,
}: {
  placeholder: string;
  /** Ingredient ids already chosen, hidden from the results. */
  excludeIds: string[];
  onSelect: (ingredient: Ingredient) => void;
  limit?: number;
  autoFocus?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return searchIngredients(query, null)
      .filter((i) => !excludeIds.includes(i.ingredient_id))
      .slice(0, limit);
  }, [query, excludeIds, limit]);

  return (
    <div className={cn("relative", className)}>
      <Search
        size={15}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-soft"
      />
      <input
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-xl border border-cream-deep bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-tomato-soft focus:ring-2 focus:ring-tomato-soft/40"
      />
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-cream-deep bg-white shadow-card">
          {results.map((ingredient) => (
            <li key={ingredient.ingredient_id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(ingredient);
                  setQuery("");
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-cream"
              >
                <span className="truncate text-charcoal">{ingredient.name}</span>
                <Plus size={14} className="shrink-0 text-tomato" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
