"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, ClipboardList, Flame } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { listAllOrders, listAllPrepTasks, setOrderStatus, watchAllOrders } from "@/lib/storage/orders";
import {
  menuPerformance,
  statusCounts,
  weeklyLoad,
  isLiveOrder,
} from "@/lib/orderStats";
import { authErrorMessage } from "@/lib/auth/errors";
import { addDays, baliWeekStart, formatBaliDay } from "@/lib/format";
import { formatIdr } from "@/lib/pricing";
import type { Order, OrderStatus, PrepTask } from "@/lib/storage/types";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import StatTile from "@/components/ui/StatTile";
import MiniBars from "@/components/ui/MiniBars";
import Button from "@/components/ui/Button";
import Input, { Select } from "@/components/ui/Input";
import OrderStatusBadge, { ORDER_LABELS } from "@/components/OrderStatusBadge";
import { useToast } from "@/components/ui/Toast";
import { ORDER_TRANSITIONS, orderTransitionDecision } from "@/lib/orderLifecycle";

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All orders" },
  { value: "submitted", label: "Awaiting acceptance" },
  { value: "accepted", label: "Accepted" },
  { value: "in_prep", label: "In the kitchen" },
  { value: "ready", label: "Ready" },
  { value: "completed", label: "Collected" },
];

/** How far back "popular lately" looks, in service weeks. */
const POPULAR_WEEKS = 4;

interface WeekGroup {
  weekStart: string;
  orders: Order[];
  meals: number;
  pickup: number;
  delivery: number;
}

/**
 * Every week the kitchen has been sent, with the controls to move it along.
 *
 * The numbers at the top are counts and nothing else. Staff already see the
 * price on each order because they hand the food over, but the money totals
 * belong to the owner dashboard — everything here comes from `lib/orderStats`,
 * which reads the order book alone and never touches a customer profile.
 */
export default function KitchenOrders() {
  const { user } = useAuth();
  const { show } = useToast();

  const [orders, setOrders] = useState<Order[]>([]);
  const [tasks, setTasks] = useState<PrepTask[]>([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextOrders, nextTasks] = await Promise.all([listAllOrders(), listAllPrepTasks()]);
      setOrders(nextOrders);
      setTasks(nextTasks);
      setError(null);
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    watchAllOrders(
      (next) => {
        if (!active) return;
        setOrders(next);
        setError(null);
        setLoading(false);
      },
      (cause) => {
        if (!active) return;
        setError(authErrorMessage(cause));
        setLoading(false);
      }
    )
      .then((off) => {
        if (active) unsubscribe = off;
        else off();
      })
      // A live listener needs an index and permissions; fall back to a plain
      // read so a missing one degrades to a static list, not an empty one.
      .catch(() => {
        if (active) void refresh();
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [refresh]);

  useEffect(() => {
    // Order snapshots and task snapshots are independent; server-side
    // transaction validation remains authoritative if this view is briefly stale.
    listAllPrepTasks().then(setTasks).catch((cause) => setError(authErrorMessage(cause)));
  }, [orders]);

  const counts = useMemo(() => statusCounts(orders), [orders]);
  const load = useMemo(() => weeklyLoad(orders, 3, 3), [orders]);
  const thisWeek = useMemo(
    () => load.find((week) => week.weekStart === baliWeekStart()),
    [load]
  );

  const popular = useMemo(() => {
    // Bounded at both ends. Without the upper bound this would quietly fold in
    // weeks not yet cooked, and "popular lately" would be describing the
    // future — which is what the Load ahead chart next to it is for.
    const thisWeekStart = baliWeekStart();
    const from = addDays(thisWeekStart, -(POPULAR_WEEKS - 1) * 7);
    return menuPerformance(
      orders.filter(
        (order) =>
          order.weekStartDate >= from && order.weekStartDate <= thisWeekStart
      )
    ).slice(0, 6);
  }, [orders]);

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const visible = orders.filter((order) => {
      if (filter !== "all" && order.status !== filter) return false;
      if (!term) return true;
      return (
        order.customer.name.toLowerCase().includes(term) ||
        order.customer.email.toLowerCase().includes(term)
      );
    });

    const buckets = new Map<string, WeekGroup>();
    for (const order of visible) {
      const weekStart = order.weekStartDate;
      let group = buckets.get(weekStart);
      if (!group) {
        group = { weekStart, orders: [], meals: 0, pickup: 0, delivery: 0 };
        buckets.set(weekStart, group);
      }
      group.orders.push(order);
      if (!isLiveOrder(order)) continue;
      for (const day of order.days) {
        const meals = day.meals.reduce((n, meal) => n + meal.servings, 0);
        group.meals += meals;
        if (day.fulfilment.mode === "delivery") group.delivery += meals;
        else group.pickup += meals;
      }
    }

    return [...buckets.values()].sort((a, b) =>
      b.weekStart.localeCompare(a.weekStart)
    );
  }, [orders, filter, search]);

  const total = groups.reduce((n, group) => n + group.orders.length, 0);

  async function move(order: Order, status: OrderStatus) {
    try {
      await setOrderStatus(order, status, user?.uid ?? "");
      show(`Order marked ${ORDER_LABELS[status].label.toLowerCase()}.`);
      await refresh();
    } catch (cause) {
      setError(authErrorMessage(cause));
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-6">
        <p className="text-sm text-charcoal-soft">Loading orders…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-4">
        <h1 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
          Orders
        </h1>
        <p className="mt-1 text-sm text-charcoal-soft">
          Every week customers have sent to the kitchen.
        </p>
      </div>

      {/* Counts. No money totals — those live on the owner dashboard. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Needs a decision"
          value={String(counts.submitted)}
          hint="waiting to be accepted"
          tone="gold"
        />
        <StatTile
          label="In the kitchen"
          value={String(counts.accepted + counts.in_prep)}
          hint="accepted or prepping"
        />
        <StatTile
          label="Ready to collect"
          value={String(counts.ready)}
          tone="basil"
        />
        <StatTile
          label="Meals this week"
          value={String(thisWeek?.meals ?? 0)}
          hint={
            thisWeek
              ? `${thisWeek.pickup} pickup · ${thisWeek.delivery} delivery`
              : undefined
          }
          tone="tomato"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-tomato-dark/30 bg-tomato-soft/20 px-3 py-2 text-sm font-600 text-tomato-dark"
        >
          {error}
        </p>
      )}

      {orders.length > 0 && (
        <div className="mb-5 grid gap-4 md:grid-cols-2">
          <Card className="p-4">
            <h2 className="font-display text-lg font-700 text-charcoal">
              Load ahead
            </h2>
            <p className="mt-0.5 text-xs text-charcoal-soft">
              Meals per service week. Weeks run forward because orders arrive
              before the week they cover.
            </p>
            <MiniBars
              className="mt-3"
              height={64}
              tone="bg-basil"
              bars={load.map((week) => ({
                label: week.weekStart.slice(5),
                value: week.meals,
                title: `Week of ${formatBaliDay(week.weekStart)} · ${week.meals} meals · ${week.orders} order${week.orders === 1 ? "" : "s"}`,
              }))}
            />
          </Card>

          {popular.length > 0 && (
            <Card className="p-4">
              <h2 className="flex items-center gap-2 font-display text-lg font-700 text-charcoal">
                <Flame size={17} className="text-tomato" /> Popular lately
              </h2>
              <p className="mt-0.5 text-xs text-charcoal-soft">
                Most-ordered dishes over the last {POPULAR_WEEKS} service weeks —
                what to keep prepped.
              </p>
              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                {popular.map((dish) => (
                  <li key={dish.name} className="tabular-nums">
                    <span className="text-charcoal">{dish.name}</span>{" "}
                    <b className="font-700 text-tomato">×{dish.servings}</b>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email"
          aria-label="Search orders by customer"
          className="w-56"
        />
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter orders"
          className="w-56"
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>

      {total === 0 ? (
        <EmptyState
          icon={<ClipboardList size={22} />}
          title="No orders here"
          hint={
            filter === "all" && !search.trim()
              ? "Nothing has been sent to the kitchen yet."
              : "Nothing matches that filter."
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.weekStart}>
              <h2 className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 border-b border-cream-deep pb-1">
                <span className="font-display text-lg font-700 text-charcoal">
                  Week of {formatBaliDay(group.weekStart)}
                </span>
                <span className="text-xs tabular-nums text-charcoal-soft">
                  {group.orders.length} order
                  {group.orders.length === 1 ? "" : "s"} · {group.meals} meal
                  {group.meals === 1 ? "" : "s"} · {group.pickup} pickup /{" "}
                  {group.delivery} delivery
                </span>
              </h2>
              <ul className="flex flex-col gap-3">
                {group.orders.map((order) => (
                  <li key={order.id}>
                    <Card className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <Link
                          href={`/kitchen/orders/${order.id}`}
                          className="min-w-0 rounded-lg hover:text-tomato"
                        >
                          <h3 className="font-600 text-charcoal hover:text-tomato">
                            {order.customer.name}
                          </h3>
                          <p className="text-xs text-charcoal-soft">
                            {order.mealCount} meal
                            {order.mealCount === 1 ? "" : "s"} ·{" "}
                            {order.days.length} day
                            {order.days.length === 1 ? "" : "s"} ·{" "}
                            {order.customer.email}
                          </p>
                          <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-600 text-tomato">
                            See what to prepare <ChevronRight size={13} />
                          </span>
                        </Link>
                        <div className="flex shrink-0 items-center gap-2">
                          <OrderStatusBadge status={order.status} />
                          <span className="text-sm font-700 tabular-nums text-charcoal">
                            {formatIdr(order.priceIdr)}
                          </span>
                        </div>
                      </div>

                      {ORDER_TRANSITIONS[order.status].staff.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2 border-t border-cream-deep pt-3">
                          {ORDER_TRANSITIONS[order.status].staff.map((next) => {
                            const decision = orderTransitionDecision(
                              order.status, next, "staff", tasks.filter((task) => task.orderId === order.id)
                            );
                            return decision.allowed ? (
                            <Button
                              key={next}
                              size="sm"
                              variant={next === "rejected" ? "danger" : "primary"}
                              onClick={() => move(order, next)}
                            >
                              {ORDER_LABELS[next].label}
                            </Button>
                            ) : (
                              <p key={next} className="w-full text-xs text-charcoal-soft">
                                <b>{ORDER_LABELS[next].label}:</b> {decision.reason}
                              </p>
                            );
                          })}
                        </div>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
