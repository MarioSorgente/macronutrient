"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, FileText, RotateCcw, Save } from "lucide-react";
import { useDishBuilder } from "@/store/dishBuilder";
import { sumDishMacros, totalGrams } from "@/lib/calc";
import { formatPrice, priceItems } from "@/lib/pricing";
import { getDishRepository } from "@/lib/storage";
import type { Dish } from "@/lib/storage/types";
import DishItemRow from "@/components/DishItemRow";
import MacroSummary from "@/components/MacroSummary";
import TemplatePicker from "@/components/TemplatePicker";

type Status = "idle" | "saving" | "saved";

export default function DishBuilder() {
  const router = useRouter();
  const { editingId, name, items, setName, setQuantity, setUnit, removeItem, reset } =
    useDishBuilder();

  const [templateOpen, setTemplateOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);

  const totals = useMemo(() => sumDishMacros(items), [items]);
  const grams = useMemo(() => totalGrams(items), [items]);
  const price = useMemo(() => priceItems(items), [items]);
  const empty = items.length === 0;

  async function persist(): Promise<Dish | null> {
    if (empty) return null;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(true);
      return null;
    }
    setStatus("saving");
    const repo = getDishRepository();
    const now = new Date().toISOString();
    const id = editingId ?? lastSavedId ?? crypto.randomUUID();
    const existing = editingId ? await repo.get(editingId) : null;
    const dish: Dish = {
      id,
      name: trimmed,
      items,
      totals,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await repo.save(dish);
    // Adopt the id so subsequent saves update the same record.
    useDishBuilder.setState({ editingId: id });
    setLastSavedId(id);
    setStatus("saved");
    return dish;
  }

  async function handleSave() {
    await persist();
  }

  async function handleReport() {
    const dish = await persist();
    if (dish) router.push(`/report/${dish.id}`);
  }

  return (
    <section className="flex min-w-0 flex-col rounded-xl2 border border-cream-deep bg-white/60 p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-700 text-charcoal">Your dish</h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTemplateOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-cream-deep px-2.5 py-1.5 text-xs font-600 text-charcoal-soft hover:text-charcoal"
          >
            <BookOpen size={14} /> Menu templates
          </button>
          {!empty && (
            <button
              type="button"
              onClick={() => {
                reset();
                setStatus("idle");
                setLastSavedId(null);
              }}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-600 text-charcoal-soft hover:text-tomato-dark"
            >
              <RotateCcw size={14} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Dish name */}
      <input
        type="text"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (nameError) setNameError(false);
          if (status === "saved") setStatus("idle");
        }}
        placeholder="Name this dish…"
        className={
          "w-full rounded-xl border bg-cream px-3 py-2.5 font-display text-lg font-600 text-charcoal outline-none focus:ring-2 " +
          (nameError
            ? "border-tomato ring-tomato/30"
            : "border-cream-deep focus:border-tomato-soft focus:ring-tomato-soft/40")
        }
      />
      {nameError && (
        <p className="mt-1 text-xs font-600 text-tomato-dark">
          Give the dish a name before saving.
        </p>
      )}

      {/* Items */}
      <ul className="mt-3 flex flex-col gap-2">
        {items.map((item) => (
          <DishItemRow
            key={item.ingredientId}
            item={item}
            onSetQuantity={(q) => setQuantity(item.ingredientId, q)}
            onSetUnit={(unitId) => setUnit(item.ingredientId, unitId)}
            onRemove={() => removeItem(item.ingredientId)}
          />
        ))}
      </ul>

      {empty && (
        <div className="mt-3 rounded-xl border border-dashed border-cream-deep px-4 py-10 text-center">
          <p className="font-600 text-charcoal">No ingredients yet</p>
          <p className="mt-1 text-sm text-charcoal-soft">
            Add ingredients from the list, or load a Negrita menu template.
          </p>
        </div>
      )}

      {/* Totals + actions */}
      {!empty && (
        <div className="mt-5 border-t border-cream-deep pt-4">
          <MacroSummary macros={totals} totalGrams={grams} />

          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-cream px-3 py-2 text-xs">
            <span className="font-600 text-charcoal-soft">
              Cost at DIY menu prices
            </span>
            <span className="font-700 tabular-nums text-charcoal">
              {formatPrice(price)}
            </span>
            {price.unpricedCount > 0 && (
              <span className="w-full text-[11px] text-charcoal-soft">
                {price.unpricedCount} ingredient
                {price.unpricedCount === 1 ? " is" : "s are"} not sold as a DIY
                component, so this is a minimum.
              </span>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={handleSave}
              disabled={status === "saving"}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-tomato bg-white px-4 py-2.5 font-700 text-tomato transition-colors hover:bg-tomato/5 disabled:opacity-60"
            >
              <Save size={17} />
              {status === "saved" ? "Saved ✓" : "Save dish"}
            </button>
            <button
              type="button"
              onClick={handleReport}
              disabled={status === "saving"}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-tomato px-4 py-2.5 font-700 text-cream transition-colors hover:bg-tomato-dark disabled:opacity-60"
            >
              <FileText size={17} /> Generate report
            </button>
          </div>
        </div>
      )}

      {templateOpen && (
        <TemplatePicker onClose={() => setTemplateOpen(false)} />
      )}
    </section>
  );
}
