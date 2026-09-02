"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { roleLabel } from "@/lib/roles";
import { getUser, listOrdersByUser } from "@/lib/storage/orders";
import {
  customerRollup,
  favouriteMeals,
  SEGMENT_LABELS,
} from "@/lib/admin/analytics";
import { authErrorMessage } from "@/lib/auth/errors";
import { formatBaliDay, formatBaliDateTime } from "@/lib/format";
import { formatIdr } from "@/lib/pricing";
import type { Order, UserProfile } from "@/lib/storage/types";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import StatTile from "@/components/ui/StatTile";
import Badge from "@/components/ui/Badge";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import MacroChips from "@/components/MacroChips";
import { orderServings } from "@/lib/orders";

/** One customer: how they came in, what they ordered, what it was worth. */
export default function CustomerDetail() {
  const params = useParams<{ uid: string }>();
  const uid = params?.uid;
  const { role } = useAuth();

  const [person, setPerson] = useState<UserProfile | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    let active = true;

    // One document and one indexed query, rather than every user and 500
    // orders fetched only to throw nearly all of them away.
    Promise.all([getUser(uid), listOrdersByUser(uid)])
      .then(([found, theirOrders]) => {
        if (!active) return;
        setPerson(found);
        setOrders(theirOrders);
      })
      .catch((cause) => active && setError(authErrorMessage(cause)))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [uid]);

  // One row through the same rollup the dashboard table uses, so this page and
  // that one can never disagree about someone's spend or whether they lapsed.
  const row = useMemo(
    () => (person ? customerRollup([person], orders)[0] : undefined),
    [person, orders]
  );
  const favourites = useMemo(() => favouriteMeals(orders, 6), [orders]);

  if (role !== "admin") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={<ShieldAlert size={22} />}
          title="Owner access only"
          hint="Customer records include contact details and spend."
        />
      </main>
    );
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-16">
        <p className="text-sm text-charcoal-soft">Loading customer…</p>
      </main>
    );
  }

  if (!person) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState title="Customer not found" hint={error ?? undefined} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <Link
        href="/admin"
        className="mb-2 flex items-center gap-1.5 text-xs font-600 text-charcoal-soft hover:text-charcoal"
      >
        <ArrowLeft size={14} /> Dashboard
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
          {person.displayName || person.email}
        </h1>
        {row && (
          <Badge
            tone={
              row.segment === "active"
                ? "verified"
                : row.segment === "new"
                  ? "info"
                  : row.segment === "lapsed"
                    ? "warning"
                    : "neutral"
            }
          >
            {SEGMENT_LABELS[row.segment]}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-sm text-charcoal-soft">
        {person.email}
        {person.phone ? ` · ${person.phone}` : ""} · joined{" "}
        {person.createdAt ? formatBaliDay(person.createdAt) : "unknown"}
        {person.role ? ` · ${roleLabel(person.role)}` : ""}
        {row?.lastOrderWeek
          ? ` · last ordered ${formatBaliDay(row.lastOrderWeek)}`
          : ""}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Orders" value={String(orders.length)} />
        <StatTile
          label="Meals"
          value={String(orders.reduce((n, o) => n + orderServings(o), 0))}
        />
        <StatTile
          label="Lifetime"
          value={formatIdr(row?.lifetimeIdr ?? 0)}
          tone="tomato"
        />
        <StatTile
          label="Avg order"
          value={formatIdr(row?.avgOrderIdr ?? 0)}
          hint="per order"
        />
        <StatTile
          label="Logins"
          value={String(person.loginCount ?? 0)}
          hint={
            person.lastLoginAt
              ? `last ${formatBaliDay(person.lastLoginAt)}`
              : "never signed in"
          }
        />
      </div>

      {favourites.length > 0 && (
        <Card className="mt-5 p-4">
          <h2 className="font-display text-lg font-700 text-charcoal">
            What they order
          </h2>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {favourites.map((meal) => (
              <li key={meal.name} className="tabular-nums">
                <span className="text-charcoal">{meal.name}</span>{" "}
                <b className="font-700 text-tomato">×{meal.count}</b>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <h2 className="mt-6 font-display text-lg font-700 text-charcoal">
        Order history
      </h2>
      {orders.length === 0 ? (
        <EmptyState
          className="mt-2"
          title="No orders yet"
          hint="This person has an account but has not sent a week to the kitchen."
        />
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {orders.map((order) => (
            <li key={order.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-600 text-charcoal">
                      Week of {formatBaliDay(order.weekStartDate)}
                    </h3>
                    <p className="text-xs text-charcoal-soft">
                      {orderServings(order)} meals · sent{" "}
                      {formatBaliDateTime(order.submittedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <OrderStatusBadge status={order.status} />
                    <span className="text-sm font-700 tabular-nums text-charcoal">
                      {formatIdr(order.priceIdr)}
                    </span>
                  </div>
                </div>
                <MacroChips macros={order.totals} className="mt-2" />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
