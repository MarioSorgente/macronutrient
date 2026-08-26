"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Settings2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  DASHBOARD_ORDER_LIMIT,
  listAllOrders,
  listUsers,
} from "@/lib/storage/orders";
import { customerRollup } from "@/lib/admin/analytics";
import { ordersInPeriod, periodRange, type Period } from "@/lib/orderStats";
import { authErrorMessage } from "@/lib/auth/errors";
import type { Order, UserProfile } from "@/lib/storage/types";
import EmptyState from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Input";
import SegmentedToggle from "@/components/SegmentedToggle";
import OverviewTab from "@/components/admin/OverviewTab";
import CustomersTab from "@/components/admin/CustomersTab";
import MenuTab from "@/components/admin/MenuTab";

/**
 * What the restaurant is actually doing: who signed up, who is using it, what
 * was ordered and what it earned.
 *
 * Every figure is derived from the orders and profiles read here, rather than
 * from counters maintained elsewhere — one source of truth, and no chance of
 * the dashboard and the order book disagreeing about revenue.
 *
 * This component is deliberately only the shell: the guard, one read, the
 * period, and which tab is showing. Each tab computes its own numbers from the
 * same two arrays, so nothing has to be threaded through twice.
 */

type Tab = "overview" | "customers" | "menu";

const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "customers", label: "Customers" },
  { value: "menu", label: "Menu" },
];

const PERIODS: { value: Period; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export default function AdminDashboard() {
  const { role } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [period, setPeriod] = useState<Period>("90d");
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([listAllOrders(DASHBOARD_ORDER_LIMIT), listUsers()])
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

  const range = useMemo(() => periodRange(period), [period]);
  const scoped = useMemo(() => ordersInPeriod(orders, range), [orders, range]);
  const rows = useMemo(
    () => customerRollup(users, scoped, orders),
    [users, scoped, orders]
  );

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
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
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

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <SegmentedToggle
          value={tab}
          options={TABS}
          onChange={setTab}
          ariaLabel="Dashboard section"
        />
        <Select
          value={period}
          onChange={(e) => setPeriod(e.target.value as Period)}
          aria-label="Period"
          className="w-44"
        >
          {PERIODS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {tab === "overview" && (
        <OverviewTab
          users={users}
          orders={scoped}
          allOrders={orders}
          range={range}
          period={period}
        />
      )}
      {tab === "customers" && <CustomersTab rows={rows} range={range} />}
      {tab === "menu" && <MenuTab orders={scoped} range={range} />}

      <p className="mt-5 text-[11px] text-charcoal-soft">
        Periods are measured by the week the food is served, not the day the
        order was typed — a week counts in whichever period its Monday falls in.
        {orders.length >= DASHBOARD_ORDER_LIMIT && (
          <>
            {" "}
            Showing the most recent {DASHBOARD_ORDER_LIMIT} orders, so anything
            older is not counted here.
          </>
        )}
      </p>
    </main>
  );
}
