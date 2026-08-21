"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Pencil, Trash2, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { getDishRepository, isCloudBackend } from "@/lib/storage";
import type { Dish } from "@/lib/storage/types";
import { useDishBuilder } from "@/store/dishBuilder";
import { formatDate } from "@/lib/format";
import { formatPrice, priceItems } from "@/lib/pricing";
import MacroChips from "@/components/MacroChips";

export default function SavedDishList() {
  const router = useRouter();
  const loadDish = useDishBuilder((s) => s.loadDish);
  const [dishes, setDishes] = useState<Dish[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const repo = getDishRepository();
    setDishes(await repo.list());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function openInBuilder(dish: Dish) {
    loadDish(dish);
    router.push("/");
  }

  async function remove(id: string) {
    await getDishRepository().remove(id);
    setPendingDelete(null);
    refresh();
  }

  if (dishes === null) {
    return <p className="text-sm text-charcoal-soft">Loading saved dishes…</p>;
  }

  if (dishes.length === 0) {
    return (
      <div className="rounded-xl2 border border-dashed border-cream-deep bg-white/50 px-6 py-16 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl2 bg-cream-deep text-tomato">
          <UtensilsCrossed size={22} />
        </div>
        <p className="font-display text-lg font-700 text-charcoal">
          No saved dishes yet
        </p>
        <p className="mt-1 text-sm text-charcoal-soft">
          Build a dish and save it — it will show up here.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
        >
          Go to builder
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!isCloudBackend() && (
        <p className="rounded-lg bg-cream-deep px-3 py-2 text-xs text-charcoal-soft">
          Saved on this device (browser storage). Connect Firebase later to share
          dishes across devices.
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {dishes.map((dish) => (
          <li
            key={dish.id}
            className="flex flex-col rounded-xl2 border border-cream-deep bg-white/70 p-4 shadow-card"
          >
            <div className="flex-1">
              <h3 className="font-display text-lg font-700 text-charcoal">
                {dish.name}
              </h3>
              <p className="mt-0.5 text-xs text-charcoal-soft">
                {dish.items.length} ingredient
                {dish.items.length === 1 ? "" : "s"} · saved{" "}
                {formatDate(dish.updatedAt)}
              </p>
              <MacroChips macros={dish.totals} gramSuffix className="mt-3">
                <span className="font-600 text-charcoal">
                  {formatPrice(priceItems(dish.items))}
                </span>
              </MacroChips>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => openInBuilder(dish)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-cream-deep bg-cream px-3 py-2 text-sm font-600 text-charcoal hover:border-tomato-soft"
              >
                <Pencil size={15} /> Open
              </button>
              <Link
                href={`/report/${dish.id}`}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-tomato px-3 py-2 text-sm font-600 text-cream hover:bg-tomato-dark"
              >
                <FileText size={15} /> Report
              </Link>
              {pendingDelete === dish.id ? (
                <button
                  type="button"
                  onClick={() => remove(dish.id)}
                  className="rounded-lg bg-tomato-dark px-2.5 py-2 text-xs font-700 text-cream"
                >
                  Confirm
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setPendingDelete(dish.id)}
                  className="rounded-lg p-2 text-charcoal-soft hover:bg-tomato-soft/30 hover:text-tomato-dark"
                  aria-label={`Delete ${dish.name}`}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
