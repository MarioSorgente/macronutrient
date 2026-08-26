"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { listAllOrders, setOrderStatus } from "@/lib/storage/orders";
import { authErrorMessage } from "@/lib/auth/errors";
import { formatBaliDay } from "@/lib/format";
import { formatIdr } from "@/lib/pricing";
import type { Order, OrderStatus } from "@/lib/storage/types";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import OrderStatusBadge, { ORDER_LABELS } from "@/components/OrderStatusBadge";
import { useToast } from "@/components/ui/Toast";
import { ORDER_TRANSITIONS } from "@/lib/orderLifecycle";

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All orders" },
  { value: "submitted", label: "Awaiting acceptance" },
  { value: "accepted", label: "Accepted" },
  { value: "in_prep", label: "In the kitchen" },
  { value: "ready", label: "Ready" },
  { value: "completed", label: "Collected" },
];

/** Every week the kitchen has been sent, with the controls to move it along. */
export default function KitchenOrders() {
  const { user } = useAuth();
  const { show } = useToast();

  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setOrders(await listAllOrders());
      setError(null);
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(
    () => (filter === "all" ? orders : orders.filter((o) => o.status === filter)),
    [orders, filter]
  );

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
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
            Orders
          </h1>
          <p className="mt-1 text-sm text-charcoal-soft">
            Every week customers have sent to the kitchen.
          </p>
        </div>
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

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-tomato-dark/30 bg-tomato-soft/20 px-3 py-2 text-sm font-600 text-tomato-dark"
        >
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={22} />}
          title="No orders here"
          hint={
            filter === "all"
              ? "Nothing has been sent to the kitchen yet."
              : "Nothing matches that filter."
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((order) => (
            <li key={order.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-600 text-charcoal">
                      {order.customer.name}
                      <span className="text-charcoal-soft">
                        {" "}
                        · week of {formatBaliDay(order.weekStartDate)}
                      </span>
                    </h2>
                    <p className="text-xs text-charcoal-soft">
                      {order.mealCount} meal{order.mealCount === 1 ? "" : "s"} ·{" "}
                      {order.days.length} day{order.days.length === 1 ? "" : "s"} ·{" "}
                      {order.customer.email}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <OrderStatusBadge status={order.status} />
                    <span className="text-sm font-700 tabular-nums text-charcoal">
                      {formatIdr(order.priceIdr)}
                    </span>
                  </div>
                </div>

                {ORDER_TRANSITIONS[order.status].staff.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-cream-deep pt-3">
                    {ORDER_TRANSITIONS[order.status].staff.map((next) => (
                      <Button
                        key={next}
                        size="sm"
                        variant={
                          next === "rejected" ? "danger" : "primary"
                        }
                        onClick={() => move(order, next)}
                      >
                        {ORDER_LABELS[next].label}
                      </Button>
                    ))}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
