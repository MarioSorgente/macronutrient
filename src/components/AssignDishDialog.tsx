"use client";

import { useMemo, useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import type { Dish } from "@/lib/storage/types";
import { sumDishMacros } from "@/lib/calc";
import { round0, round1 } from "@/lib/format";

/**
 * Picks a saved dish (and a serving count) to drop into a meal slot.
 */
export default function AssignDishDialog({
  dishes,
  slot,
  dayLabel,
  onAssign,
  onClose,
}: {
  dishes: Dish[];
  slot: string;
  dayLabel: string;
  onAssign: (dish: Dish, servings: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [servings, setServings] = useState(1);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? dishes.filter((d) => d.name.toLowerCase().includes(q)) : dishes;
  }, [dishes, query]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-charcoal/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl2 bg-cream shadow-card sm:rounded-xl2"
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

        {/* Servings */}
        <div className="flex items-center gap-3 border-b border-cream-deep px-4 py-3">
          <span className="text-sm font-600 text-charcoal">Servings</span>
          <div className="flex items-center rounded-lg border border-cream-deep bg-white">
            <button
              type="button"
              onClick={() => setServings((s) => Math.max(0.5, s - 0.5))}
              className="grid h-8 w-8 place-items-center rounded-l-lg text-charcoal-soft hover:bg-cream-deep"
              aria-label="Fewer servings"
            >
              <Minus size={14} />
            </button>
            <span className="w-12 border-x border-cream-deep py-1 text-center text-sm font-600 tabular-nums">
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
                Build and save a dish first, then assign it here.
              </p>
              <Link
                href="/"
                className="mt-4 inline-flex rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
              >
                Go to builder
              </Link>
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {results.map((dish) => {
                const totals = sumDishMacros(dish.items);
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
                        <div className="text-[11px] tabular-nums text-charcoal-soft">
                          {round0(totals.energy_kcal * servings)} kcal · P{" "}
                          {round1(totals.protein_g * servings)} · C{" "}
                          {round1(totals.carbs_g * servings)} · F{" "}
                          {round1(totals.fat_g * servings)}
                        </div>
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
      </div>
    </div>
  );
}
