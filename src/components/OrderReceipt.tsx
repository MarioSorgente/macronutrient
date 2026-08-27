"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Bike, ShoppingBag } from "lucide-react";
import { cancelOrder, getOrder } from "@/lib/storage/orders";
import { useAuth } from "@/lib/auth/AuthProvider";
import ConfirmButton from "@/components/ui/ConfirmButton";
import { authErrorMessage } from "@/lib/auth/errors";
import { BALI_LABEL, formatBaliDay, formatBaliDateTime, round0 } from "@/lib/format";
import { formatIdr } from "@/lib/pricing";
import type { Order } from "@/lib/storage/types";
import ReportShell, { ReportMessage } from "@/components/ReportShell";
import MacroSummary from "@/components/MacroSummary";
import MacroChips from "@/components/MacroChips";
import OrderStatusBadge, { ORDER_LABELS } from "@/components/OrderStatusBadge";

/** A printable record of one submitted week, for the customer. */
export default function OrderReceipt() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [order, setOrder] = useState<Order | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!id) return;
    let active = true;

    getOrder(id)
      .then((loaded) => {
        if (!active) return;
        setOrder(loaded);
        setState(loaded ? "ready" : "missing");
      })
      .catch((cause) => {
        if (!active) return;
        setError(authErrorMessage(cause));
        setState("missing");
      });

    return () => {
      active = false;
    };
  }, [id]);

  if (state === "loading") return <ReportMessage>Loading order…</ReportMessage>;

  if (state === "missing" || !order) {
    return (
      <ReportMessage>
        <p className="font-display text-xl font-700 text-charcoal">
          Order not found
        </p>
        <p className="mt-1 text-sm text-charcoal-soft">
          {error ?? "It may belong to a different account."}
        </p>
      </ReportMessage>
    );
  }

  return (
    <ReportShell
      backHref="/orders"
      backLabel="Back to orders"
      kind="Kitchen order"
      dateIso={order.submittedAt}
      footnote="Payment is arranged directly with the restaurant."
      toolbar={
        order.status === "submitted" && order.userId === user?.uid ? (
          <ConfirmButton
            text="Cancel this week"
            confirmLabel="Yes, cancel it"
            label="Cancel this order"
            onConfirm={async () => {
              try {
                await cancelOrder(order, user?.uid ?? "");
                setOrder({ ...order, status: "cancelled" });
              } catch (cause) {
                setError(authErrorMessage(cause));
              }
            }}
          />
        ) : undefined
      }
    >
      <div className="py-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-3xl font-700 text-charcoal">
            Week of {formatBaliDay(order.weekStartDate)}
          </h1>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className="mt-1 text-sm text-charcoal-soft">
          For {order.customer.name} · {order.mealCount} meal
          {order.mealCount === 1 ? "" : "s"} across {order.days.length} day
          {order.days.length === 1 ? "" : "s"} · sent{" "}
          {formatBaliDateTime(order.submittedAt)} ({BALI_LABEL})
        </p>
        {order.statusHistory.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-charcoal-soft">
            {order.statusHistory.map((entry) => (
              <li key={`${entry.status}-${entry.at}`} className="tabular-nums">
                <span className="font-600 text-charcoal">
                  {ORDER_LABELS[entry.status].label}
                </span>{" "}
                {formatBaliDateTime(entry.at)}
              </li>
            ))}
          </ul>
        )}
        {order.restaurantNote && (
          <p className="mt-2 rounded-xl border border-cream-deep bg-cream px-3 py-2 text-sm text-charcoal">
            <b className="font-700">From Negrita:</b> {order.restaurantNote}
          </p>
        )}
      </div>

      <MacroSummary macros={order.totals} />

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-cream-deep bg-cream px-3 py-2">
        <span className="text-sm font-600 text-charcoal">Total</span>
        <span className="font-display text-xl font-700 tabular-nums text-charcoal">
          {formatIdr(order.priceIdr)}
        </span>
      </div>

      {order.days.map((day) => (
        <section key={day.date} className="mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-cream-deep pb-1">
            <h2 className="font-display text-lg font-700 text-charcoal">
              {formatBaliDay(day.date)}
            </h2>
            <span className="flex items-center gap-1.5 text-sm text-charcoal-soft">
              {day.fulfilment.mode === "delivery" ? (
                <Bike size={14} />
              ) : (
                <ShoppingBag size={14} />
              )}
              {day.fulfilment.mode === "delivery" ? "Delivery" : "Pickup"} by{" "}
              <b className="font-700 text-charcoal">{day.fulfilment.time}</b>
            </span>
          </div>

          {day.fulfilment.address && (
            <p className="mt-1 text-xs text-charcoal-soft">
              To: {day.fulfilment.address}
            </p>
          )}

          <ul className="mt-2 flex flex-col gap-2">
            {day.meals.map((meal) => (
              <li
                key={meal.assignmentId}
                className="flex flex-wrap items-baseline justify-between gap-2"
              >
                <div className="min-w-0">
                  <span className="text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
                    {meal.slot}
                  </span>{" "}
                  <span className="font-600 text-charcoal">{meal.name}</span>
                  {meal.servings !== 1 && (
                    <span className="text-charcoal-soft"> ×{meal.servings}</span>
                  )}
                  <MacroChips macros={meal.totals} size="xxs" className="mt-0.5" />
                </div>
                <span className="shrink-0 text-sm tabular-nums text-charcoal">
                  {formatIdr(meal.priceIdr)}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-2 text-right text-xs tabular-nums text-charcoal-soft">
            {round0(day.meals.reduce((n, m) => n + m.totals.energy_kcal, 0))} kcal
            for the day
          </p>
        </section>
      ))}
    </ReportShell>
  );
}
