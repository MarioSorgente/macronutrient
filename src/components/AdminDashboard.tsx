"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, Settings2, ShieldAlert, Users } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { listAllOrders, listUsers } from "@/lib/storage/orders";
import {
  customerRollup,
  favouriteMeals,
  revenueByWeek,
  revenueTotals,
  toCsv,
  usageSummary,
  type CustomerRow,
} from "@/lib/admin/analytics";
import { authErrorMessage } from "@/lib/auth/errors";
import { formatBaliDay } from "@/lib/format";
import { formatIdr } from "@/lib/pricing";
import type { Order, UserProfile } from "@/lib/storage/types";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import StatTile from "@/components/ui/StatTile";
import MiniBars from "@/components/ui/MiniBars";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Button from "@/components/ui/Button";

/**
 * What the restaurant is actually doing: who signed up, who is using it, what
 * was ordered and what it earned.
 *
 * Every figure is derived from the orders and profiles read here, rather than
 * from counters maintained elsewhere — one source of truth, and no chance of
 * the dashboard and the order book disagreeing about revenue.
 */
export default function AdminDashboard() {
  const { role } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([listAllOrders(300), listUsers()])
      .then(([loadedOrders, loadedUsers]) => {
        if (!active) return;
        setOrders(loadedOrders);
        setUsers(loadedUsers);
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
  }, []);

  const summary = useMemo(() => usageSummary(users, orders), [users, orders]);
  const revenue = useMemo(() => revenueTotals(orders), [orders]);
  const weeks = useMemo(() => revenueByWeek(orders), [orders]);
  const rows = useMemo(() => customerRollup(users, orders), [users, orders]);
  const favourites = useMemo(() => favouriteMeals(orders), [orders]);

  const columns: Column<CustomerRow>[] = [
    {
      key: "name",
      header: "Name",
      cell: (r) => (
        <Link
          href={`/admin/customers/${r.uid}`}
          className="font-600 text-charcoal hover:text-tomato"
        >
          {r.name}
        </Link>
      ),
      sortBy: (r) => r.name.toLowerCase(),
    },
    { key: "email", header: "Email", cell: (r) => r.email, sortBy: (r) => r.email },
    {
      key: "joined",
      header: "Joined",
      cell: (r) => (r.joined ? formatBaliDay(r.joined) : "—"),
      sortBy: (r) => r.joined ?? "",
    },
    {
      key: "lastLogin",
      header: "Last seen",
      cell: (r) => (r.lastLoginAt ? formatBaliDay(r.lastLoginAt) : "never"),
      sortBy: (r) => r.lastLoginAt ?? "",
    },
    { key: "logins", header: "Logins", cell: (r) => r.logins, sortBy: (r) => r.logins, align: "right" },
    { key: "orders", header: "Orders", cell: (r) => r.orders, sortBy: (r) => r.orders, align: "right" },
    { key: "meals", header: "Meals", cell: (r) => r.meals, sortBy: (r) => r.meals, align: "right" },
    {
      key: "lifetime",
      header: "Lifetime",
      cell: (r) => formatIdr(r.lifetimeIdr),
      sortBy: (r) => r.lifetimeIdr,
      align: "right",
    },
  ];

  function downloadCsv() {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mamma-calories-customers-${formatBaliDay(new Date().toISOString())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (role !== "admin") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={<ShieldAlert size={22} />}
          title="Owner access only"
          hint="The dashboard shows revenue and customer details, so it is limited to the account that owns the restaurant."
        />
      </main>
    );
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-16">
        <p className="text-sm text-charcoal-soft">Loading the numbers…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-charcoal-soft">
            Everything Negrita has signed up, served and earned.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/settings"
            className="inline-flex items-center gap-1.5 rounded-xl border border-cream-deep bg-white px-3 py-2 text-sm font-600 text-charcoal"
          >
            <Settings2 size={15} /> Settings
          </Link>
          <Link
            href="/admin/house-items"
            className="inline-flex items-center gap-1.5 rounded-xl border border-cream-deep bg-white px-3 py-2 text-sm font-600 text-charcoal"
          >
            House items
          </Link>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-tomato-dark/30 bg-tomato-soft/20 px-3 py-2 text-sm font-600 text-tomato-dark"
        >
          {error}
        </p>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatTile label="Customers" value={String(summary.customers)} />
        <StatTile label="New this month" value={String(summary.newThisMonth)} tone="basil" />
        <StatTile label="Active 7 days" value={String(summary.activeLast7Days)} tone="basil" />
        <StatTile label="Orders this month" value={String(summary.ordersThisMonth)} />
        <StatTile
          label="Revenue this month"
          value={formatIdr(summary.revenueThisMonthIdr)}
          tone="tomato"
        />
        <StatTile
          label="Lifetime"
          value={formatIdr(summary.lifetimeIdr)}
          tone="tomato"
        />
      </div>

      {/* Revenue */}
      <Card className="mt-5 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-lg font-700 text-charcoal">
            Revenue by service week
          </h2>
          <dl className="flex flex-wrap gap-4 text-sm">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-charcoal-soft">
                Committed
              </dt>
              <dd className="font-700 tabular-nums text-charcoal">
                {formatIdr(revenue.committedIdr)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-charcoal-soft">
                Realised
              </dt>
              <dd className="font-700 tabular-nums text-basil">
                {formatIdr(revenue.realisedIdr)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-charcoal-soft">
                Collected
              </dt>
              <dd className="font-700 tabular-nums text-charcoal-soft">
                {formatIdr(revenue.collectedIdr)}
              </dd>
            </div>
          </dl>
        </div>
        <p className="mt-1 text-[11px] text-charcoal-soft">
          Weeks are when the food is served, so upcoming weeks already on the
          books are included. Committed is everything ordered and not cancelled;
          realised is what the customer actually collected; collected is what has
          been recorded as paid — zero until payments are tracked in the app.
        </p>
        <MiniBars
          className="mt-4"
          bars={weeks.map((w) => ({
            label: w.weekStart.slice(5),
            value: w.idr,
            title: `Week of ${formatBaliDay(w.weekStart)} · ${formatIdr(w.idr)} · ${w.orders} order${w.orders === 1 ? "" : "s"}`,
          }))}
          format={formatIdr}
        />
      </Card>

      {/* Customers */}
      <Card className="mt-5 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-display text-lg font-700 text-charcoal">
            <Users size={17} className="text-tomato" /> Customers
          </h2>
          <Button size="sm" onClick={downloadCsv} icon={<Download size={14} />}>
            Export CSV
          </Button>
        </div>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.uid}
          initialSort={{ key: "lifetime", dir: "desc" }}
          empty={
            <EmptyState
              title="No customers yet"
              hint="Accounts appear here as soon as someone signs up."
            />
          }
        />
      </Card>

      {/* Favourites */}
      {favourites.length > 0 && (
        <Card className="mt-5 p-4">
          <h2 className="font-display text-lg font-700 text-charcoal">
            Most ordered
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
    </main>
  );
}
