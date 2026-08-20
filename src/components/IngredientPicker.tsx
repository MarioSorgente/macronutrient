"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, Clock, Search, X } from "lucide-react";
import type { Ingredient } from "@/types/nutrition";
import {
  categories,
  categoryLabel,
  getIngredient,
  rankIngredients,
  searchIngredients,
} from "@/lib/database";
import { categoryStyle } from "@/lib/categoryStyle";
import { useDishBuilder } from "@/store/dishBuilder";
import { useHouseRecipes } from "@/store/houseRecipes";
import { useRecentIngredients } from "@/lib/recent";
import IngredientRow from "@/components/IngredientRow";

type SortMode = "relevance" | "name" | "calories" | "protein";

const SORTS: { id: SortMode; label: string }[] = [
  { id: "relevance", label: "Best match" },
  { id: "name", label: "Name" },
  { id: "calories", label: "Calories" },
  { id: "protein", label: "Protein" },
];

export default function IngredientPicker() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>("relevance");
  const [activeIndex, setActiveIndex] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const items = useDishBuilder((s) => s.items);
  const addIngredient = useDishBuilder((s) => s.addIngredient);
  // Re-render when a house recipe changes an ingredient's values.
  const houseVersion = useHouseRecipes((s) => s.version);
  const { recentIds, remember } = useRecentIngredients();

  const inDish = useMemo(
    () => new Set(items.map((it) => it.ingredientId)),
    [items]
  );

  const tokens = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query]
  );

  const results = useMemo(() => {
    const found = searchIngredients(query, category);
    switch (sort) {
      case "name":
        return [...found].sort((a, b) => a.name.localeCompare(b.name));
      case "calories":
        return [...found].sort(
          (a, b) => b.macros_per_100g.energy_kcal - a.macros_per_100g.energy_kcal
        );
      case "protein":
        return [...found].sort(
          (a, b) => b.macros_per_100g.protein_g - a.macros_per_100g.protein_g
        );
      default:
        return rankIngredients(found, query);
    }
    // houseVersion participates so overridden values re-sort correctly.

  }, [query, category, sort, houseVersion]);

  // Recently used ingredients, shown only on the unfiltered default view.
  const recent = useMemo(() => {
    if (query || category) return [];
    return recentIds
      .map((id) => getIngredient(id))
      .filter((x): x is Ingredient => Boolean(x))
      .slice(0, 5);

  }, [recentIds, query, category, houseVersion]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, category, sort]);

  function add(ingredient: Ingredient) {
    addIngredient(ingredient);
    remember(ingredient.ingredient_id);
  }

  // "/" focuses search from anywhere on the page.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = results[activeIndex];
      if (target && !inDish.has(target.ingredient_id)) add(target);
    } else if (e.key === "Escape") {
      setQuery("");
    }
  }

  // Keep the keyboard-selected row in view.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>("[data-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    // min-w-0 lets the horizontally scrolling chip row shrink instead of
    // stretching the grid track (grid/flex items default to min-width:auto).
    <section className="flex min-w-0 flex-col rounded-xl2 border border-cream-deep bg-white/60 p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-700 text-charcoal">Ingredients</h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs font-600 text-charcoal-soft">
            <ArrowUpDown size={13} />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="rounded-lg border border-cream-deep bg-cream px-1.5 py-1 text-xs font-600 text-charcoal outline-none focus:border-tomato-soft"
              aria-label="Sort ingredients"
            >
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <span className="text-xs font-600 text-charcoal-soft">
            {results.length}
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-soft"
        />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Search ingredients or menu names…"
          className="w-full rounded-xl border border-cream-deep bg-cream py-2.5 pl-9 pr-16 text-sm text-charcoal outline-none focus:border-tomato-soft focus:ring-2 focus:ring-tomato-soft/40"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-charcoal-soft hover:text-charcoal"
            aria-label="Clear search"
          >
            <X size={15} />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-cream-deep bg-white px-1.5 py-0.5 text-[10px] font-600 text-charcoal-soft sm:block">
            /
          </kbd>
        )}
      </div>

      {/* Category chips */}
      <div className="scroll-slim mt-3 flex gap-1.5 overflow-x-auto pb-1">
        <Chip label="All" active={category === null} onClick={() => setCategory(null)} />
        {categories.map((c) => {
          const { icon: Icon } = categoryStyle(c);
          return (
            <Chip
              key={c}
              label={categoryLabel(c)}
              icon={<Icon size={12} />}
              active={category === c}
              onClick={() => setCategory(category === c ? null : c)}
            />
          );
        })}
      </div>

      {/* Recently used */}
      {recent.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-700 uppercase tracking-[0.14em] text-charcoal-soft">
            <Clock size={12} /> Recently used
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((ing) => (
              <button
                key={ing.ingredient_id}
                type="button"
                onClick={() => add(ing)}
                disabled={inDish.has(ing.ingredient_id)}
                className="rounded-full border border-cream-deep bg-cream px-2.5 py-1 text-xs font-600 text-charcoal transition-colors hover:border-tomato-soft hover:bg-tomato/5 disabled:opacity-40"
              >
                {ing.name.length > 26 ? `${ing.name.slice(0, 26)}…` : ing.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      <ul
        ref={listRef}
        className="scroll-slim mt-3 flex max-h-[52vh] flex-col gap-2 overflow-y-auto pr-1 lg:max-h-[calc(100vh-22rem)]"
      >
        {results.map((ing, index) => (
          <div key={ing.ingredient_id} data-active={index === activeIndex}>
            <IngredientRow
              ingredient={ing}
              inDish={inDish.has(ing.ingredient_id)}
              tokens={tokens}
              isActive={index === activeIndex && tokens.length > 0}
              onAdd={add}
            />
          </div>
        ))}

        {results.length === 0 && (
          <li className="rounded-xl border border-dashed border-cream-deep px-3 py-10 text-center">
            <p className="font-600 text-charcoal">No ingredients match</p>
            <p className="mt-1 text-sm text-charcoal-soft">
              Try a shorter word{category ? ", or clear the category filter" : ""}.
            </p>
            {category && (
              <button
                type="button"
                onClick={() => setCategory(null)}
                className="mt-3 rounded-lg bg-tomato px-3 py-1.5 text-xs font-700 text-cream hover:bg-tomato-dark"
              >
                Search all categories
              </button>
            )}
          </li>
        )}
      </ul>
    </section>
  );
}

function Chip({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-600 transition-colors " +
        (active
          ? "bg-charcoal text-cream"
          : "bg-cream-deep text-charcoal-soft hover:bg-tomato-soft/40 hover:text-charcoal")
      }
    >
      {icon}
      {label}
    </button>
  );
}
