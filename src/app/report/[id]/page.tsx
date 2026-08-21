"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useRepos } from "@/lib/storage/repos";
import type { Dish } from "@/lib/storage/types";
import { getIngredient } from "@/lib/database";
import { perItemMacros, sumDishMacros, totalGrams } from "@/lib/calc";
import { round0, round1 } from "@/lib/format";
import { formatPrice, priceItems } from "@/lib/pricing";
import MacroSummary from "@/components/MacroSummary";
import ReportShell, { ReportMessage } from "@/components/ReportShell";

type LoadState = "loading" | "ready" | "missing";

export default function ReportPage() {
  const repos = useRepos();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [dish, setDish] = useState<Dish | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    if (!id) return;
    repos.dishes
      .get(id)
      .then((d) => {
        setDish(d);
        setState(d ? "ready" : "missing");
      })
      .catch(() => setState("missing"));
  }, [id, repos]);

  const totals = useMemo(
    () => (dish ? sumDishMacros(dish.items) : null),
    [dish]
  );

  if (state === "loading") {
    return (
      <ReportMessage>
        <p className="text-charcoal-soft">Loading report…</p>
      </ReportMessage>
    );
  }

  if (state === "missing" || !dish || !totals) {
    return (
      <ReportMessage>
        <p className="font-display text-xl font-700 text-charcoal">
          Report not found
        </p>
        <p className="mt-1 text-sm text-charcoal-soft">
          This dish may have been saved on a different device or deleted.
        </p>
        <Link
          href="/plan/dishes"
          className="mt-4 inline-flex rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
        >
          Back to saved dishes
        </Link>
      </ReportMessage>
    );
  }

  const grams = totalGrams(dish.items);

  return (
    <ReportShell
      backHref="/plan/dishes"
      backLabel="Back"
      kind="Nutrition report"
      dateIso={dish.updatedAt}
      footnote="Some restaurant values are estimates or proxies; confirm against weighed recipes for production accuracy."
    >
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

    </ReportShell>
  );
}


