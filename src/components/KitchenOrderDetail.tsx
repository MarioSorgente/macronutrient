"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Bike,
  ClipboardList,
  Mail,
  Phone,
  Printer,
  ShoppingBag,
  UtensilsCrossed,
} from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getOrder, setOrderStatus } from "@/lib/storage/orders";
import { miseEnPlace, prepTasksFor } from "@/lib/orders";
import { ORDER_TRANSITIONS } from "@/lib/orderLifecycle";
import { authErrorMessage } from "@/lib/auth/errors";
import { BALI_LABEL, formatBaliDay, formatBaliDateTime, round0 } from "@/lib/format";
import { formatIdr } from "@/lib/pricing";
import type { Order, OrderDay, OrderStatus } from "@/lib/storage/types";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import OrderStatusBadge, { ORDER_LABELS } from "@/components/OrderStatusBadge";
import MacroChips from "@/components/MacroChips";
import { useToast } from "@/components/ui/Toast";

/**
 * One order, as the kitchen needs to read it.
 *
 * Staff could not open an order at all: the order book listed cards that linked
 * nowhere, and accepting one changed a badge and nothing else. Everything the
 * kitchen actually needs was already on the order — who ordered it, which day
 * each meal is for, by what time, for pickup or delivery, to what address, and
 * the ingredients with their grams — and none of it was ever rendered.
 *
 * `/orders/[id]` is not the answer: it is written for the person eating the
 * food, and the route policy now limits it to the `client` role, so staff
 * cannot open it. This is the kitchen's own view of the same record.
 */
export default function KitchenOrderDetail() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id;
  const { user, role } = useAuth();
  const { show } = useToast();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orderId) return;
    try {
      setOrder(await getOrder(orderId));
      setError(null);
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Days in the order they are cooked, not the order they were stored. */
  const days = useMemo(
    () => [...(order?.days ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    [order]
  );

  /**
   * Everything to have in hand for the whole order, by ingredient. Built from
   * the same prep tasks the kitchen board is made of, so the two agree.
   */
  const shopping = useMemo(
    () =>
      order
        ? miseEnPlace(
            prepTasksFor(order, (id, date, assignmentId) => `${id}:${date}:${assignmentId}`)
          )
        : [],
    [order]
  );

  async function move(next: OrderStatus) {
    if (!order || busy) return;
    setBusy(true);
    try {
      await setOrderStatus(order, next, user?.uid ?? "");
      show(`Order marked ${ORDER_LABELS[next].label.toLowerCase()}.`);
      await load();
      setError(null);
    } catch (cause) {
      // The kitchen has to know the transition did not take. Failing silently
      // here would leave someone cooking an order they think they rejected.
      setError(authErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-16">
        <p className="text-sm text-charcoal-soft">Loading the order…</p>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={<ClipboardList size={22} />}
          title="Order not found"
          hint={error ?? "It may have been cancelled, or the link is wrong."}
          action={
            <Link
              href="/kitchen/orders"
              className="inline-flex rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
            >
              Back to orders
            </Link>
          }
        />
      </main>
    );
  }

  const transitions = ORDER_TRANSITIONS[order.status].staff;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <Link
        href="/kitchen/orders"
        className="no-print mb-2 flex items-center gap-1.5 text-xs font-600 text-charcoal-soft hover:text-charcoal"
      >
        <ArrowLeft size={14} /> Orders
      </Link>

      {/* Who, and how far along */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
              {order.customer.name}
            </h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-charcoal-soft">
            <span>Week of {formatBaliDay(order.weekStartDate)}</span>
            <span>
              {order.mealCount} meal{order.mealCount === 1 ? "" : "s"} ·{" "}
              {days.length} day{days.length === 1 ? "" : "s"}
            </span>
            <span className="font-700 tabular-nums text-charcoal">
              {formatIdr(order.priceIdr)}
            </span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <a
              href={`mailto:${order.customer.email}`}
              className="flex items-center gap-1.5 text-charcoal-soft hover:text-tomato"
            >
              <Mail size={13} /> {order.customer.email}
            </a>
            {role === "admin" && (
              <Link
                href={`/admin/customers/${order.userId}`}
                className="text-charcoal-soft underline hover:text-tomato"
              >
                Customer record
              </Link>
            )}
            {order.customer.phone && (
              <a
                href={`tel:${order.customer.phone}`}
                className="flex items-center gap-1.5 text-charcoal-soft hover:text-tomato"
              >
                <Phone size={13} /> {order.customer.phone}
              </a>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="no-print flex items-center gap-1.5 rounded-lg border border-cream-deep bg-white px-3 py-2 text-sm font-600 text-charcoal"
        >
          <Printer size={15} /> Print
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-tomato-dark/30 bg-tomato-soft/20 px-3 py-2 text-sm font-600 text-tomato-dark"
        >
          {error}
        </p>
      )}

      {/* When: what has happened to this order so far. */}
      <Card className="mt-4 p-4">
        <h2 className="font-display text-lg font-700 text-charcoal">Progress</h2>
        <ol className="mt-2 flex flex-col gap-1 text-sm">
          <li className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-600 text-charcoal">Sent by the customer</span>
            <span className="tabular-nums text-charcoal-soft">
              {formatBaliDateTime(order.submittedAt)}
            </span>
          </li>
          {order.statusHistory.map((entry) => (
            <li
              key={`${entry.status}-${entry.at}`}
              className="flex flex-wrap items-baseline justify-between gap-x-3"
            >
              <span className="font-600 text-charcoal">
                {ORDER_LABELS[entry.status].label}
              </span>
              <span className="tabular-nums text-charcoal-soft">
                {formatBaliDateTime(entry.at)}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] text-charcoal-soft">{BALI_LABEL}</p>

        {transitions.length > 0 && (
          <div className="no-print mt-3 flex flex-wrap gap-2 border-t border-cream-deep pt-3">
            {transitions.map((next) => (
              <Button
                key={next}
                size="sm"
                disabled={busy}
                variant={next === "rejected" ? "danger" : "primary"}
                onClick={() => move(next)}
              >
                {ORDER_LABELS[next].label}
              </Button>
            ))}
          </div>
        )}
      </Card>

      {/* What to prepare, day by day. */}
      <h2 className="mt-6 font-display text-lg font-700 text-charcoal">
        What to prepare
      </h2>
      <div className="mt-2 flex flex-col gap-4">
        {days.map((day) => (
          <DaySection key={day.date} day={day} />
        ))}
      </div>

      {shopping.length > 0 && (
        <Card className="mt-6 p-4">
          <h2 className="flex items-center gap-2 font-display text-lg font-700 text-charcoal">
            <UtensilsCrossed size={17} className="text-tomato" /> Everything in
            this order
          </h2>
          <p className="mt-0.5 text-xs text-charcoal-soft">
            Every ingredient across the whole week, already scaled by servings.
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {shopping.map((item) => (
              <li key={item.ingredientId} className="tabular-nums">
                <span className="text-charcoal">{item.name}</span>{" "}
                <b className="font-700 text-tomato">{round0(item.grams)} g</b>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}

/** One service day: when it has to be ready, how it leaves, and what is in it. */
function DaySection({ day }: { day: OrderDay }) {
  const meals = day.meals.reduce((n, meal) => n + meal.servings, 0);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-cream-deep pb-2">
        <h3 className="font-display text-lg font-700 text-charcoal">
          {formatBaliDay(day.date)}
        </h3>
        <span className="flex items-center gap-1.5 text-sm text-charcoal-soft">
          {day.fulfilment.mode === "delivery" ? (
            <Bike size={14} />
          ) : (
            <ShoppingBag size={14} />
          )}
          {day.fulfilment.mode === "delivery" ? "Deliver" : "Pickup"} by{" "}
          <b className="font-700 text-charcoal">{day.fulfilment.time}</b>
          <span className="text-charcoal-soft">
            · {meals} meal{meals === 1 ? "" : "s"}
          </span>
        </span>
      </div>

      {day.fulfilment.address && (
        <p className="mt-2 text-sm text-charcoal">
          <span className="text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
            Deliver to
          </span>{" "}
          {day.fulfilment.address}
        </p>
      )}
      {day.fulfilment.note && (
        <p className="mt-1 text-sm text-charcoal-soft">{day.fulfilment.note}</p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {day.meals.map((meal) => (
          <li key={meal.assignmentId}>
            <details className="rounded-lg border border-cream-deep bg-white px-3 py-2">
              <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0">
                  <span className="text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
                    {meal.slot}
                  </span>{" "}
                  <span className="font-600 text-charcoal">{meal.name}</span>
                  {meal.servings !== 1 && (
                    <span className="text-charcoal-soft"> ×{meal.servings}</span>
                  )}
                </span>
                <span className="text-[11px] text-charcoal-soft">
                  {meal.items.length} ingredient
                  {meal.items.length === 1 ? "" : "s"}
                </span>
              </summary>

              <MacroChips macros={meal.totals} size="xxs" className="mt-2" />
              <ul className="mt-2 flex flex-col gap-0.5 border-t border-cream-deep pt-2 text-xs tabular-nums text-charcoal-soft">
                {meal.items.map((item) => (
                  <li
                    key={item.ingredientId}
                    className="flex justify-between gap-2"
                  >
                    <span className="truncate">{item.name}</span>
                    {/* Scaled by servings, exactly as the prep board scales it. */}
                    <span className="shrink-0">
                      {round0(item.grams * meal.servings)} g
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>

      <Link
        href={`/kitchen/${day.date}`}
        className="no-print mt-3 inline-flex text-xs font-600 text-charcoal-soft underline hover:text-tomato"
      >
        Prep board for this day
      </Link>
    </Card>
  );
}
