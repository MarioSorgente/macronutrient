"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Printer, UtensilsCrossed } from "lucide-react";
import { getDishRepository } from "@/lib/storage";
import type { Dish } from "@/lib/storage/types";
import { getIngredient } from "@/lib/database";
import { perItemMacros, sumDishMacros, totalGrams } from "@/lib/calc";
import { formatDate, round0, round1 } from "@/lib/format";
import { formatPrice, priceItems } from "@/lib/pricing";
import { databaseMeta } from "@/lib/database";
import MacroSummary from "@/components/MacroSummary";

type LoadState = "loading" | "ready" | "missing";

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [dish, setDish] = useState<Dish | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    if (!id) return;
    getDishRepository()
      .get(id)
      .then((d) => {
        setDish(d);
        setState(d ? "ready" : "missing");
      })
      .catch(() => setState("missing"));
  }, [id]);

  const totals = useMemo(
    () => (dish ? sumDishMacros(dish.items) : null),
    [dish]
  );

  if (state === "loading") {
    return (
      <CenterMessage>
        <p className="text-charcoal-soft">Loading report…</p>
      </CenterMessage>
    );
  }

  if (state === "missing" || !dish || !totals) {
    return (
      <CenterMessage>
        <p className="font-display text-xl font-700 text-charcoal">
          Report not found
        </p>
        <p className="mt-1 text-sm text-charcoal-soft">
          This dish may have been saved on a different device or deleted.
        </p>
        <Link
          href="/dishes"
          className="mt-4 inline-flex rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
        >
          Back to saved dishes
        </Link>
      </CenterMessage>
    );
  }

  const grams = totalGrams(dish.items);

  return (
    <div className="min-h-screen">
      {/* Action bar (hidden when printing) */}
      <div className="no-print sticky top-0 z-10 border-b border-cream-deep bg-cream/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link
            href="/dishes"
            className="flex items-center gap-1.5 text-sm font-600 text-charcoal-soft hover:text-charcoal"
          >
            <ArrowLeft size={16} /> Back
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-2 rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
          >
            <Printer size={16} /> Print / Save as PDF
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <article className="print-page rounded-xl2 border border-cream-deep bg-white p-6 shadow-card sm:p-8">
          {/* Brand header */}
          <div className="flex items-center justify-between border-b border-cream-deep pb-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl2 bg-tomato text-cream">
                <UtensilsCrossed size={20} />
              </span>
              <div className="leading-tight">
                <div className="font-display text-lg font-700 text-charcoal">
                  Mamma Calories
                </div>
                <div className="text-[11px] font-600 uppercase tracking-[0.18em] text-tomato">
                  For Negrita
                </div>
              </div>
            </div>
            <div className="text-right text-xs text-charcoal-soft">
              <div>Nutrition report</div>
              <div>{formatDate(dish.updatedAt)}</div>
            </div>
          </div>

          {/* Dish title */}
          <div className="py-5">
            <h1 className="font-display text-3xl font-700 text-charcoal">
              {dish.name}
            </h1>
            <p className="mt-1 text-sm text-charcoal-soft">
              {dish.items.length} ingredient{dish.items.length === 1 ? "" : "s"} ·{" "}
              {round0(grams)} g total ·{" "}
              <span className="font-600 text-charcoal">
                {formatPrice(priceItems(dish.items))}
              </span>
            </p>
          </div>

          {/* Summary */}
          <MacroSummary macros={totals} totalGrams={grams} />

          {/* Breakdown table */}
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-cream-deep text-left text-[11px] uppercase tracking-wide text-charcoal-soft">
                  <th className="py-2 pr-2 font-600">Ingredient</th>
                  <th className="py-2 px-2 text-right font-600">Grams</th>
                  <th className="py-2 px-2 text-right font-600">kcal</th>
                  <th className="py-2 px-2 text-right font-600">Protein</th>
                  <th className="py-2 px-2 text-right font-600">Carbs</th>
                  <th className="py-2 px-2 text-right font-600">Fat</th>
                  <th className="py-2 pl-2 text-right font-600">Fiber</th>
                </tr>
              </thead>
              <tbody>
                {dish.items.map((item) => {
                  const ing = getIngredient(item.ingredientId);
                  const c = ing
                    ? perItemMacros(ing, item.grams)
                    : null;
                  return (
                    <tr
                      key={item.ingredientId}
                      className="border-b border-cream-deep/60"
                    >
                      <td className="py-2 pr-2 font-600 text-charcoal">
                        {ing?.name ?? item.name}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {round0(item.grams)}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums font-600 text-tomato">
                        {c ? round0(c.energy_kcal) : "—"}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {c ? round1(c.protein_g) : "—"}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {c ? round1(c.carbs_g) : "—"}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {c ? round1(c.fat_g) : "—"}
                      </td>
                      <td className="py-2 pl-2 text-right tabular-nums">
                        {c ? round1(c.fiber_g) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-charcoal/20 font-700 text-charcoal">
                  <td className="py-2 pr-2">Total</td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {round0(grams)}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-tomato">
                    {round0(totals.energy_kcal)}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {round1(totals.protein_g)}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {round1(totals.carbs_g)}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {round1(totals.fat_g)}
                  </td>
                  <td className="py-2 pl-2 text-right tabular-nums">
                    {round1(totals.fiber_g)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Footer note */}
          <p className="mt-6 border-t border-cream-deep pt-4 text-[11px] leading-relaxed text-charcoal-soft">
            Macros are calculated from each ingredient&apos;s per-100&nbsp;g values
            as{" "}
            <span className="font-600">grams ÷ 100 × value per 100&nbsp;g</span>.
            Source: {databaseMeta.name} (v{databaseMeta.version}). Some restaurant
            values are estimates or proxies; confirm against weighed recipes for
            production accuracy.
          </p>
        </article>
      </main>
    </div>
  );
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="text-center">{children}</div>
    </div>
  );
}
