"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { categories, categoryLabel, searchIngredients } from "@/lib/database";
import { useDishBuilder } from "@/store/dishBuilder";
import IngredientRow from "@/components/IngredientRow";

export default function IngredientPicker() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  const items = useDishBuilder((s) => s.items);
  const addIngredient = useDishBuilder((s) => s.addIngredient);

  const inDish = useMemo(
    () => new Set(items.map((it) => it.ingredientId)),
    [items]
  );

  const results = useMemo(
    () => searchIngredients(query, category),
    [query, category]
  );

  return (
    <section className="flex flex-col rounded-xl2 border border-cream-deep bg-white/60 p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-700 text-charcoal">
          Ingredients
        </h2>
        <span className="text-xs font-600 text-charcoal-soft">
          {results.length} shown
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-soft"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ingredients or menu names…"
          className="w-full rounded-xl border border-cream-deep bg-cream py-2.5 pl-9 pr-9 text-sm text-charcoal outline-none focus:border-tomato-soft focus:ring-2 focus:ring-tomato-soft/40"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-charcoal-soft hover:text-charcoal"
            aria-label="Clear search"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Category chips */}
      <div className="scroll-slim mt-3 flex gap-1.5 overflow-x-auto pb-1">
        <Chip
          label="All"
          active={category === null}
          onClick={() => setCategory(null)}
        />
        {categories.map((c) => (
          <Chip
            key={c}
            label={categoryLabel(c)}
            active={category === c}
            onClick={() => setCategory(c)}
          />
        ))}
      </div>

      {/* Results */}
      <ul className="scroll-slim mt-3 flex max-h-[52vh] flex-col gap-2 overflow-y-auto pr-1 lg:max-h-[calc(100vh-19rem)]">
        {results.map((ing) => (
          <IngredientRow
            key={ing.ingredient_id}
            ingredient={ing}
            inDish={inDish.has(ing.ingredient_id)}
            onAdd={addIngredient}
          />
        ))}
        {results.length === 0 && (
          <li className="rounded-xl border border-dashed border-cream-deep px-3 py-8 text-center text-sm text-charcoal-soft">
            No ingredients match “{query}”.
          </li>
        )}
      </ul>
    </section>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-600 transition-colors " +
        (active
          ? "bg-charcoal text-cream"
          : "bg-cream-deep text-charcoal-soft hover:bg-tomato-soft/40 hover:text-charcoal")
      }
    >
      {label}
    </button>
  );
}
