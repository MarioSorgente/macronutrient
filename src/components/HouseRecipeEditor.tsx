"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import type { Ingredient } from "@/types/nutrition";
import { getIngredient } from "@/lib/database";
import { houseRecipeMacrosPer100g } from "@/lib/calc";
import { useHouseRecipes } from "@/store/houseRecipes";
import type { HouseRecipe, HouseRecipeComponent } from "@/lib/storage/types";
import { formatMacroGrams, round0 } from "@/lib/format";
import MacroChips from "@/components/MacroChips";
import IngredientTypeahead from "@/components/IngredientTypeahead";
import NumberField from "@/components/ui/NumberField";
import Modal from "@/components/ui/Modal";

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

  function addComponent(ing: Ingredient) {
    if (components.some((c) => c.ingredientId === ing.ingredient_id)) return;
    setComponents([...components, { ingredientId: ing.ingredient_id, grams: 100 }]);
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
    <Modal
      title={ingredient.name}
      subtitle="Enter the batch recipe and its finished weight to replace the estimate."
      onClose={onClose}
      size="xl"
      footer={
        <>
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
        </>
      }
    >
          {/* Add component */}
          <IngredientTypeahead
            placeholder="Add an ingredient to the recipe…"
            excludeIds={[
              ingredient.ingredient_id,
              ...components.map((c) => c.ingredientId),
            ]}
            onSelect={addComponent}
          />

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
                  <NumberField
                    decimals
                    min={0}
                    value={component.grams}
                    onChange={(gramsTyped) =>
                      setComponents(
                        components.map((c) =>
                          c.ingredientId === component.ingredientId
                            ? { ...c, grams: gramsTyped }
                            : c
                        )
                      )
                    }
                    className="w-20 rounded-lg border border-cream-deep px-2 py-1 text-right text-sm font-600 tabular-nums outline-none focus:border-tomato-soft"
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
                onWheel={(e) => e.currentTarget.blur()}
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
              <MacroChips
                macros={preview}
                size="sm"
                tone="strong"
                gramSuffix
                showFiber
                className="mt-2"
              />
              <p className="mt-2 text-[11px] text-charcoal-soft">
                Replaces the shipped estimate of {round0(ingredient.macros_per_100g.energy_kcal)} kcal
                / P {formatMacroGrams(ingredient.macros_per_100g.protein_g)} / C{" "}
                {formatMacroGrams(ingredient.macros_per_100g.carbs_g)} / F{" "}
                {formatMacroGrams(ingredient.macros_per_100g.fat_g)}.
              </p>
            </div>
          )}
    </Modal>
  );
}
