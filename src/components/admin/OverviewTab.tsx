"use client";

import { useMemo, useState } from "react";
import { periodStats, revenueByWeek, revenueTotals } from "@/lib/admin/analytics";
import type { Period, PeriodRange } from "@/lib/orderStats";
import { formatBaliDay } from "@/lib/format";
import { formatIdr } from "@/lib/pricing";
import type { Order, UserProfile } from "@/lib/storage/types";
import Card from "@/components/ui/Card";
import StatTile from "@/components/ui/StatTile";
import MiniBars from "@/components/ui/MiniBars";
import SegmentedToggle from "@/components/SegmentedToggle";

type Metric = "revenue" | "orders" | "meals" | "customers";

const METRICS: {
  value: Metric;
  label: string;
  tone: string;
  format: (n: number) => string;
}[] = [
  { value: "revenue", label: "Revenue", tone: "bg-tomato", format: formatIdr },
  { value: "orders", label: "Orders", tone: "bg-charcoal", format: String },
  { value: "meals", label: "Meals", tone: "bg-basil", format: String },
  { value: "customers", label: "Customers", tone: "bg-gold", format: String },
];

/**
 * How many weeks of history the chart shows for each period.
 *
 * Roughly matches the window the tiles are counting, so the bars and the
 * numbers above them are talking about the same stretch of time.
 */
const WEEKS_BACK: Record<Period, number> = {
  "30d": 5,
  month: 5,
  "90d": 13,
  all: 26,
};

/** The headline numbers, and the trend behind them. */
export default function OverviewTab({
  users,
  orders,
  allOrders,
  range,
  period,
}: {
  users: UserProfile[];
  orders: Order[];
  allOrders: Order[];
  range: PeriodRange;
  period: Period;
}) {
  const [metric, setMetric] = useState<Metric>("revenue");

  const stats = useMemo(
    () => periodStats(users, orders, allOrders, range),
    [users, orders, allOrders, range]
  );
  // Across everything read, not the selected period: scoped to the period this
  // would just restate the Revenue tile above, and the question these three
  // answer — how much of what was promised has actually been handed over and
  // paid for — is not one a 30-day window improves.
  const revenue = useMemo(() => revenueTotals(allOrders), [allOrders]);
  const weeks = useMemo(
    () => revenueByWeek(allOrders, WEEKS_BACK[period], 2),
    [allOrders, period]
  );

  const active = METRICS.find((m) => m.value === metric)!;
  const valueOf = (week: (typeof weeks)[number]) =>
    metric === "revenue"
      ? week.idr
      : metric === "orders"
        ? week.orders
        : metric === "meals"
          ? week.meals
          : week.customers;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Revenue"
          value={formatIdr(stats.revenueIdr)}
          hint={range.label}
          tone="tomato"
        />
        <StatTile
          label="Orders"
          value={String(stats.orders)}
          hint={range.label}
        />
        <StatTile
          label="Avg order"
          value={formatIdr(stats.avgOrderIdr)}
          hint="per order in period"
        />
        <StatTile label="Meals" value={String(stats.meals)} hint={range.label} />
        <StatTile
          label="On the books"
          value={formatIdr(stats.onTheBooksIdr)}
          hint="this week onward, all periods"
          tone="gold"
        />
        <StatTile
          label="Customers"
          value={String(stats.customersOrdered)}
          hint="ordered in period"
        />
        <StatTile
          label="New customers"
          value={String(stats.newCustomers)}
          hint="signed up in period"
          tone="basil"
        />
        <StatTile
          label="Repeat rate"
          value={`${stats.repeatPct}%`}
          hint="ordered more than once"
          tone="basil"
        />
      </div>

      <Card className="mt-5 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-lg font-700 text-charcoal">
            Revenue by service week
            <span className="ml-2 text-sm font-500 text-charcoal-soft">
              all orders read
            </span>
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
          These three and the chart cover every order read, not the period above,
          and weeks are when the food is served — so upcoming weeks already on
          the books are included. Committed is everything ordered and not
          cancelled; realised is what the customer actually collected; collected
          is what has been recorded as paid — zero until payments are tracked in
          the app.
        </p>

        <div className="mt-3">
          <SegmentedToggle
            value={metric}
            options={METRICS.map((m) => ({ value: m.value, label: m.label }))}
            onChange={setMetric}
            ariaLabel="Chart metric"
          />
        </div>

        <MiniBars
          className="mt-3"
          tone={active.tone}
          bars={weeks.map((week) => ({
            label: week.weekStart.slice(5),
            value: valueOf(week),
            title: `Week of ${formatBaliDay(week.weekStart)} · ${formatIdr(week.idr)} · ${week.orders} order${week.orders === 1 ? "" : "s"} · ${week.meals} meals · ${week.customers} customer${week.customers === 1 ? "" : "s"}`,
          }))}
          format={active.format}
        />
      </Card>
    </>
  );
}
