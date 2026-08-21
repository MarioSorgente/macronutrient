"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Search, X } from "lucide-react";
import { menuNotes, menuRecipes } from "@/lib/database";
import { categoryLabel } from "@/lib/database";
import { formatIdr } from "@/lib/pricing";
import { useDishBuilder } from "@/store/dishBuilder";
import type { MenuRecipe } from "@/types/nutrition";

export default function TemplatePicker({ onClose }: { onClose: () => void }) {
  const loadTemplate = useDishBuilder((s) => s.loadTemplate);
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = menuRecipes.filter((r) =>
      q ? r.name.toLowerCase().includes(q) : true
    );
    const map = new Map<string, MenuRecipe[]>();
    for (const r of filtered) {
      const arr = map.get(r.section) ?? [];
      arr.push(r);
      map.set(r.section, arr);
    }
    return Array.from(map.entries());
  }, [query]);

  function choose(recipe: MenuRecipe) {
    loadTemplate(recipe);
    onClose();
  }

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
        <div className="flex items-center justify-between border-b border-cream-deep px-4 py-3">
          <div>
            <h3 className="font-display text-lg font-700 text-charcoal">
              Negrita menu templates
            </h3>
            <p className="text-xs text-charcoal-soft">
              Load a menu dish, then tweak the grams. {menuNotes.measurement}
            </p>
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
              placeholder="Search menu dishes…"
              className="w-full rounded-xl border border-cream-deep bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-tomato-soft focus:ring-2 focus:ring-tomato-soft/40"
            />
          </div>
        </div>

        <div className="scroll-slim flex-1 overflow-y-auto px-4 py-3">
          {grouped.map(([section, recipes]) => (
            <div key={section} className="mb-4 last:mb-0">
              <h4 className="mb-1 text-[11px] font-700 uppercase tracking-[0.14em] text-tomato">
                {categoryLabel(section)}
              </h4>
              {menuNotes.forSection(section) && (
                <p className="mb-1.5 text-[11px] leading-snug text-charcoal-soft">
                  {menuNotes.forSection(section)}
                </p>
              )}
              <ul className="flex flex-col gap-1.5">
                {recipes.map((r) => (
                  <li key={r.recipe_id}>
                    <button
                      type="button"
                      onClick={() => choose(r)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-cream-deep bg-white px-3 py-2.5 text-left transition-colors hover:border-tomato-soft hover:bg-tomato/5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate font-600 text-charcoal">
                            {r.name}
                          </span>
                          {typeof r.price_idr === "number" && (
                            <span className="shrink-0 text-[11px] font-700 tabular-nums text-tomato">
                              {formatIdr(r.price_idr)}
                            </span>
                          )}
                        </div>
                        {r.description && (
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-charcoal-soft">
                            {r.description}
                          </p>
                        )}
                        <div className="mt-0.5 text-[11px] text-charcoal-soft">
                          {r.components.length} ingredient
                          {r.components.length === 1 ? "" : "s"}
                          {typeof r.menu_macros_per_serving.energy_kcal ===
                            "number" && (
                            <>
                              {" · "}
                              {r.menu_macros_per_serving.energy_kcal} kcal (menu)
                            </>
                          )}
                        </div>
                      </div>
                      {!r.quantity_complete && (
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
          {grouped.length === 0 && (
            <p className="py-8 text-center text-sm text-charcoal-soft">
              No menu dishes match “{query}”.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
