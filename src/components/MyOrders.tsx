"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarRange, Receipt } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { listMyOrders } from "@/lib/storage/orders";
import { formatBaliDay } from "@/lib/format";
import { formatIdr } from "@/lib/pricing";
import { authErrorMessage } from "@/lib/auth/errors";
import type { Order } from "@/lib/storage/types";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import MacroChips from "@/components/MacroChips";

/** The weeks a person has sent to the kitchen, newest first. */
export default function MyOrders() {
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    let active = true;

    listMyOrders(user.uid)
      .then((loaded) => {
        if (active) setOrders(loaded);
      })
      .catch((cause) => {
        if (active) setError(authErrorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user, authLoading]);

  if (loading || authLoading) {
    return <p className="text-sm text-charcoal-soft">Loading your orders…</p>;
  }

  if (!user) {
    return (
      <EmptyState
        icon={<Receipt size={22} />}
        title="Sign in to see your orders"
        hint="Weeks you send to the kitchen show up here."
        action={
          <Link
            href="/login?next=/orders"
            className="inline-flex rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
          >
            Sign in
          </Link>
        }
      />
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<Receipt size={22} />}
        title="We could not load your orders"
        hint={error}
      />
    );
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={<CalendarRange size={22} />}
        title="No orders yet"
        hint="Plan a week, then send it to the kitchen."
        action={
          <Link
            href="/plan"
            className="inline-flex rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
          >
            Plan a week
          </Link>
        }
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {orders.map((order) => (
        <li key={order.id}>
          <Link href={`/orders/${order.id}`} className="block">
            <Card className="p-4 transition-colors hover:border-tomato-soft">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-600 text-charcoal">
                    Week of {formatBaliDay(order.weekStartDate)}
                  </h2>
                  <p className="text-xs text-charcoal-soft">
                    {order.mealCount} meal{order.mealCount === 1 ? "" : "s"} ·{" "}
                    {order.days.length} day{order.days.length === 1 ? "" : "s"} ·
                    sent {formatBaliDay(order.submittedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <OrderStatusBadge status={order.status} />
                  <span className="text-sm font-700 tabular-nums text-charcoal">
                    {formatIdr(order.priceIdr)}
                  </span>
                </div>
              </div>
              <MacroChips macros={order.totals} className="mt-3" />
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
