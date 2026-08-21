"use client";

import { useMemo, useState } from "react";
import { Hammer, Library, Minus, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import type { Dish, DishItem } from "@/lib/storage/types";
import type { Ingredient } from "@/types/nutrition";
import { getIngredient } from "@/lib/database";
import { addItem, setItemQuantity, setItemUnit } from "@/lib/dishItems";
import { scaleMacros, sumDishMacros, totalGrams } from "@/lib/calc";
import { formatPrice, priceItems } from "@/lib/pricing";
import { round0 } from "@/lib/format";
import DishItemRow from "@/components/DishItemRow";
import SegmentedToggle from "@/components/SegmentedToggle";
import MacroChips from "@/components/MacroChips";
import IngredientTypeahead from "@/components/IngredientTypeahead";

type Tab = "saved" | "build";

/**
 * Fills one meal slot, either from a saved dish or by building something on the
 * spot from Negrita's ingredients — so a custom meal doesn't require leaving the
 * planner for the Builder.
 */
export default function AssignDishDialog({
  dishes,
  slot,
  dayLabel,
  onAssign,
  onAssignCustom,
  onClose,
}: {
  dishes: Dish[];
  slot: string;
  dayLabel: string;
  onAssign: (dish: Dish, servings: number) => void;
  onAssignCustom: (
    name: string,
    items: DishItem[],
    servings: number,
    alsoSave: boolean
  ) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("saved");
  const [query, setQuery] = useState("");
  const [servings, setServings] = useState(1);

  // Build tab
  const [items, setItems] = useState<DishItem[]>([]);
  const [name, setName] = useState("");
  const [alsoSave, setAlsoSave] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? dishes.filter((d) => d.name.toLowerCase().includes(q)) : dishes;
  }, [dishes, query]);

  const totals = useMemo(() => sumDishMacros(items), [items]);
  const price = useMemo(() => priceItems(items), [items]);
  const grams = useMemo(() => totalGrams(items), [items]);

  // Item rules are shared with the Builder's store, so a meal composed here
  // behaves exactly like one composed on the Build page.
  function addIngredient(ingredient: Ingredient) {
    setItems((current) => addItem(current, ingredient));
  }

  function setQuantity(ingredientId: string, quantity: number) {
    setItems((current) => setItemQuantity(current, ingredientId, quantity));
  }

  function setUnit(ingredientId: string, unitId: string) {
    setItems((current) => setItemUnit(current, ingredientId, unitId));
  }

  /** Falls back to naming the meal after what is in it. */
  const derivedName =
    name.trim() ||
    items
      .map((it) => getIngredient(it.ingredientId)?.name ?? it.name)
      .slice(0, 2)
      .join(" + ");

  // Not built on ui/Modal: each tab owns its own scroll region and the Build
  // tab has a footer the Saved tab does not, so the shared single-body shell
  // would have to grow props that only this dialog would ever use.
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-charcoal/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl2 bg-cream shadow-card sm:rounded-xl2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-cream-deep px-4 py-3">
          <div>
            <h3 className="font-display text-lg font-700 text-charcoal">
              Add to {slot}
            </h3>
            <p className="text-xs text-charcoal-soft">{dayLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-charcoal-soft hover:bg-cream-deep"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs + servings */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cream-deep px-4 py-3">
          <SegmentedToggle
            ariaLabel="How to add"
            value={tab}
            onChange={setTab}
            options={[
              { value: "saved", label: "Saved", icon: <Library size={14} /> },
              { value: "build", label: "Build", icon: <Hammer size={14} /> },
            ]}
          />
          <div className="flex items-center gap-2">
            <span className="text-xs font-600 text-charcoal-soft">Servings</span>
            <div className="flex items-center rounded-lg border border-cream-deep bg-white">
              <button
                type="button"
                onClick={() => setServings((s) => Math.max(0.5, s - 0.5))}
                className="grid h-8 w-8 place-items-center rounded-l-lg text-charcoal-soft hover:bg-cream-deep"
                aria-label="Fewer servings"
              >
                <Minus size={14} />
              </button>
              <span className="w-10 border-x border-cream-deep py-1 text-center text-sm font-600 tabular-nums">
                {servings}
              </span>
              <button
                type="button"
                onClick={() => setServings((s) => s + 0.5)}
                className="grid h-8 w-8 place-items-center rounded-r-lg text-charcoal-soft hover:bg-cream-deep"
                aria-label="More servings"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        </div>

        {tab === "saved" ? (
          <>
            <div className="border-b border-cream-deep px-4 py-3">
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-soft"
                />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search saved dishes…"
                  className="w-full rounded-xl border border-cream-deep bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-tomato-soft focus:ring-2 focus:ring-tomato-soft/40"
                />
              </div>
            </div>

            <div className="scroll-slim flex-1 overflow-y-auto px-4 py-3">
              {dishes.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="font-600 text-charcoal">No saved dishes yet</p>
                  <p className="mt-1 text-sm text-charcoal-soft">
                    Switch to <b>Build</b> to put one together right here.
                  </p>
                  <Link
                    href="/"
                    className="mt-4 inline-flex rounded-xl border border-cream-deep bg-white px-4 py-2 text-sm font-600 text-charcoal"
                  >
                    Or open the builder
                  </Link>
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {results.map((dish) => {
                    const dishTotals = sumDishMacros(dish.items);
                    return (
                      <li key={dish.id}>
                        <button
                          type="button"
                          onClick={() => onAssign(dish, servings)}
                          className="flex w-full items-center justify-between gap-3 rounded-xl border border-cream-deep bg-white px-3 py-2.5 text-left transition-colors hover:border-tomato-soft hover:bg-tomato/5"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-600 text-charcoal">
                              {dish.name}
                            </div>
                            <MacroChips
                              macros={scaleMacros(dishTotals, servings)}
                              variant="dots"
                              size="xxs"
                            />
                          </div>
                          <Plus size={16} className="shrink-0 text-tomato" />
                        </button>
                      </li>
                    );
                  })}
                  {results.length === 0 && (
                    <li className="py-6 text-center text-sm text-charcoal-soft">
                      No dishes match “{query}”.
                    </li>
                  )}
                </ul>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="border-b border-cream-deep px-4 py-3">
              <IngredientTypeahead
                autoFocus
                placeholder="Search an ingredient to add…"
                excludeIds={items.map((it) => it.ingredientId)}
                onSelect={addIngredient}
              />
            </div>

            <div className="scroll-slim flex-1 overflow-y-auto px-4 py-3">
              {items.length === 0 ? (
                <p className="rounded-xl border border-dashed border-cream-deep px-3 py-8 text-center text-sm text-charcoal-soft">
                  Search above to start putting a meal together.
                </p>
              ) : (
                <>
                  <ul className="flex flex-col gap-2">
                    {items.map((item) => (
                      <DishItemRow
                        key={item.ingredientId}
                        item={item}
                        onSetQuantity={(q) => setQuantity(item.ingredientId, q)}
                        onSetUnit={(unitId) => setUnit(item.ingredientId, unitId)}
                        onRemove={() =>
                          setItems(
                            items.filter(
                              (it) => it.ingredientId !== item.ingredientId
                            )
                          )
                        }
                      />
                    ))}
                  </ul>

                  <div className="mt-3 rounded-xl border border-cream-deep bg-white px-3 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-xs font-600 uppercase tracking-wide text-charcoal-soft">
                        {servings === 1 ? "Total" : `Total × ${servings}`}
                      </span>
                      <span className="text-xs font-600 tabular-nums text-charcoal">
                        {formatPrice({
                          ...price,
                          totalIdr: price.totalIdr * servings,
                        })}
                      </span>
                    </div>
                    <MacroChips
                      macros={scaleMacros(totals, servings)}
                      size="sm"
                      className="mt-1"
                    >
                      <span className="opacity-70">{round0(grams * servings)} g</span>
                    </MacroChips>
                  </div>

                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={derivedName || "Name this meal…"}
                    className="mt-3 w-full rounded-xl border border-cream-deep bg-white px-3 py-2 text-sm outline-none focus:border-tomato-soft"
                  />

                  <label className="mt-2 flex items-center gap-2 text-xs text-charcoal-soft">
                    <input
                      type="checkbox"
                      checked={alsoSave}
                      onChange={(e) => setAlsoSave(e.target.checked)}
                      className="h-4 w-4 accent-tomato"
                    />
                    Also save to my dishes for reuse
                  </label>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-cream-deep px-4 py-3">
              <button
                type="button"
                disabled={items.length === 0}
                onClick={() =>
                  onAssignCustom(derivedName, items, servings, alsoSave)
                }
                className="rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark disabled:opacity-50"
              >
                Add to {slot}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
