"use client";

import { useMemo, useState } from "react";
import { Plus, Search, Trash2, X } from "lucide-react";
import type { Ingredient } from "@/types/nutrition";
import { getIngredient, searchIngredients } from "@/lib/database";
import { houseRecipeMacrosPer100g } from "@/lib/calc";
import { useHouseRecipes } from "@/store/houseRecipes";
import type { HouseRecipe, HouseRecipeComponent } from "@/lib/storage/types";
import { round0, round1 } from "@/lib/format";

/**
 * Defines a Negrita house item from its own components plus the finished batch
 * weight. Once saved, the computed per-100 g values replace the shipped
 * estimate everywhere in the app.
 */
export default function HouseRecipeEditor({
  ingredient,
  existing,
  onClose,
}: {
  ingredient: Ingredient;
  existing?: HouseRecipe;
  onClose: () => void;
}) {
  const save = useHouseRecipes((s) => s.save);
  const remove = useHouseRecipes((s) => s.remove);

  const [components, setComponents] = useState<HouseRecipeComponent[]>(
    existing?.components ?? []
  );
  const [yieldGrams, setYieldGrams] = useState<string>(
    existing ? String(existing.yieldGrams) : ""
  );
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const rawWeight = components.reduce((sum, c) => sum + c.grams, 0);
  const parsedYield = parseFloat(yieldGrams);
  const effectiveYield = Number.isFinite(parsedYield) ? parsedYield : 0;

  const preview = useMemo(
    () =>
      houseRecipeMacrosPer100g(
        components.map((c) => ({ ingredientId: c.ingredientId, grams: c.grams })),
        effectiveYield
      ),
    [components, effectiveYield]
  );

  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    return searchIngredients(query, null)
      .filter((i) => i.ingredient_id !== ingredient.ingredient_id)
      .slice(0, 6);
  }, [query, ingredient.ingredient_id]);

  function addComponent(ing: Ingredient) {
    if (components.some((c) => c.ingredientId === ing.ingredient_id)) return;
    setComponents([...components, { ingredientId: ing.ingredient_id, grams: 100 }]);
    setQuery("");
  }

  async function handleSave() {
    if (!components.length || effectiveYield <= 0) return;
    setSaving(true);
    const now = new Date().toISOString();
    const recipe: HouseRecipe = {
      id: ingredient.ingredient_id,
      ingredientId: ingredient.ingredient_id,
      components,
      yieldGrams: effectiveYield,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await save(recipe);
    setSaving(false);
    onClose();
  }

  async function handleReset() {
    await remove(ingredient.ingredient_id);
    onClose();
  }

  const canSave = components.length > 0 && effectiveYield > 0;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-charcoal/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-t-xl2 bg-cream shadow-card sm:rounded-xl2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-cream-deep px-4 py-3">
          <div>
            <h3 className="font-display text-lg font-700 text-charcoal">
              {ingredient.name}
            </h3>
            <p className="text-xs text-charcoal-soft">
              Enter the batch recipe and its finished weight to replace the estimate.
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

        <div className="scroll-slim flex-1 overflow-y-auto px-4 py-3">
          {/* Add component */}
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-soft"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Add an ingredient to the recipe…"
              className="w-full rounded-xl border border-cream-deep bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-tomato-soft focus:ring-2 focus:ring-tomato-soft/40"
            />
            {searchResults.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-cream-deep bg-white shadow-card">
                {searchResults.map((ing) => (
                  <li key={ing.ingredient_id}>
                    <button
                      type="button"
                      onClick={() => addComponent(ing)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-cream"
                    >
                      <span className="truncate text-charcoal">{ing.name}</span>
                      <Plus size={14} className="shrink-0 text-tomato" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Components */}
          <ul className="mt-3 flex flex-col gap-2">
            {components.map((component) => {
              const ing = getIngredient(component.ingredientId);
              return (
                <li
                  key={component.ingredientId}
                  className="flex items-center gap-2 rounded-xl border border-cream-deep bg-white px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-600 text-charcoal">
                    {ing?.name ?? component.ingredientId}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={component.grams}
                    onChange={(e) =>
                      setComponents(
                        components.map((c) =>
                          c.ingredientId === component.ingredientId
                            ? { ...c, grams: Math.max(0, parseFloat(e.target.value) || 0) }
                            : c
                        )
                      )
                    }
                    className="no-spin w-20 rounded-lg border border-cream-deep px-2 py-1 text-right text-sm font-600 tabular-nums outline-none focus:border-tomato-soft"
                    aria-label={`Grams of ${ing?.name ?? component.ingredientId}`}
                  />
                  <span className="text-xs font-600 text-charcoal-soft">g</span>
                  <button
                    type="button"
                    onClick={() =>
                      setComponents(
                        components.filter(
                          (c) => c.ingredientId !== component.ingredientId
                        )
                      )
                    }
                    className="rounded-lg p-1.5 text-charcoal-soft hover:bg-tomato-soft/30 hover:text-tomato-dark"
                    aria-label="Remove component"
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              );
            })}
            {components.length === 0 && (
              <li className="rounded-xl border border-dashed border-cream-deep px-3 py-6 text-center text-sm text-charcoal-soft">
                Add the ingredients that go into one batch.
              </li>
            )}
          </ul>

          {/* Yield */}
          <div className="mt-4 rounded-xl border border-cream-deep bg-white p-3">
            <label className="block text-sm font-600 text-charcoal">
              Finished batch weight
            </label>
            <p className="mt-0.5 text-xs text-charcoal-soft">
              Weigh the batch after cooking. Raw total is {round0(rawWeight)} g —
              a lower finished weight means water cooked off and the result is more
              concentrated.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={yieldGrams}
                onChange={(e) => setYieldGrams(e.target.value)}
                placeholder={String(Math.round(rawWeight) || 1000)}
                className="no-spin w-28 rounded-lg border border-cream-deep px-2 py-1.5 text-right text-sm font-600 tabular-nums outline-none focus:border-tomato-soft"
              />
              <span className="text-sm font-600 text-charcoal-soft">g</span>
              {rawWeight > 0 && (
                <button
                  type="button"
                  onClick={() => setYieldGrams(String(Math.round(rawWeight)))}
                  className="rounded-lg bg-cream-deep px-2 py-1 text-xs font-600 text-charcoal-soft hover:text-charcoal"
                >
                  Same as raw
                </button>
              )}
            </div>
          </div>

          {/* Preview */}
          {preview && (
            <div className="mt-4 rounded-xl border border-basil/30 bg-basil/5 p-3">
              <h4 className="text-[11px] font-700 uppercase tracking-wide text-basil">
                Computed per 100 g
              </h4>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-charcoal">
                <span>
                  <b className="text-tomato">{round0(preview.energy_kcal)}</b> kcal
                </span>
                <span>P {round1(preview.protein_g)} g</span>
                <span>C {round1(preview.carbs_g)} g</span>
                <span>F {round1(preview.fat_g)} g</span>
                <span>Fiber {round1(preview.fiber_g)} g</span>
              </div>
              <p className="mt-2 text-[11px] text-charcoal-soft">
                Replaces the shipped estimate of {round0(ingredient.macros_per_100g.energy_kcal)} kcal
                / P {round1(ingredient.macros_per_100g.protein_g)} / C{" "}
                {round1(ingredient.macros_per_100g.carbs_g)} / F{" "}
                {round1(ingredient.macros_per_100g.fat_g)}.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-cream-deep px-4 py-3">
          {existing && (
            <button
              type="button"
              onClick={handleReset}
              className="rounded-xl px-3 py-2 text-sm font-600 text-charcoal-soft hover:text-tomato-dark"
            >
              Reset to estimate
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-cream-deep bg-white px-4 py-2 text-sm font-600 text-charcoal"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || saving}
            className="rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark disabled:opacity-50"
          >
            Save recipe
          </button>
        </div>
      </div>
    </div>
  );
}
