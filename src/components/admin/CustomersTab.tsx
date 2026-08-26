"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Download, HeartCrack, Users } from "lucide-react";
import {
  retention,
  SEGMENT_LABELS,
  toCsv,
  type CustomerRow,
  type Segment,
} from "@/lib/admin/analytics";
import type { PeriodRange } from "@/lib/orderStats";
import { formatBaliDay } from "@/lib/format";
import { formatIdr } from "@/lib/pricing";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ShareBar from "@/components/ui/ShareBar";
import DataTable, { type Column } from "@/components/ui/DataTable";

const SEGMENT_TONES: Record<Segment, BadgeTone> = {
  active: "verified",
  new: "info",
  lapsed: "warning",
  never: "neutral",
};

/** Who the customers are, and which of them are drifting away. */
export default function CustomersTab({
  rows,
  range,
}: {
  rows: CustomerRow[];
  range: PeriodRange;
}) {
  const segments = useMemo(() => retention(rows), [rows]);

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
    {
      key: "segment",
      header: "Segment",
      cell: (r) => (
        <Badge tone={SEGMENT_TONES[r.segment]}>{SEGMENT_LABELS[r.segment]}</Badge>
      ),
      sortBy: (r) => r.segment,
    },
    {
      key: "joined",
      header: "Joined",
      cell: (r) => (r.joined ? formatBaliDay(r.joined) : "—"),
      sortBy: (r) => r.joined ?? "",
    },
    {
      key: "lastOrder",
      header: "Last order",
      cell: (r) => (r.lastOrderWeek ? formatBaliDay(r.lastOrderWeek) : "never"),
      sortBy: (r) => r.lastOrderWeek ?? "",
    },
    {
      key: "orders",
      header: "Orders",
      cell: (r) => r.orders,
      sortBy: (r) => r.orders,
      align: "right",
    },
    {
      key: "meals",
      header: "Meals",
      cell: (r) => r.meals,
      sortBy: (r) => r.meals,
      align: "right",
    },
    {
      key: "avg",
      header: "Avg order",
      cell: (r) => (r.avgOrderIdr ? formatIdr(r.avgOrderIdr) : "—"),
      sortBy: (r) => r.avgOrderIdr,
      align: "right",
    },
    {
      key: "spend",
      header: "Spend",
      cell: (r) => formatIdr(r.spendIdr),
      sortBy: (r) => r.spendIdr,
      align: "right",
    },
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

  return (
    <>
      <Card className="p-4">
        <h2 className="font-display text-lg font-700 text-charcoal">
          Where everyone stands
        </h2>
        <p className="mb-3 mt-1 text-[11px] text-charcoal-soft">
          Measured against service weeks and never narrowed by the period, so a
          customer booked in for next week counts as active and nobody is filed
          as lapsed just because the filter excluded them.
        </p>
        <ShareBar
          slices={[
            { label: "Active", value: segments.counts.active, tone: "bg-basil" },
            { label: "New", value: segments.counts.new, tone: "bg-tomato" },
            { label: "Lapsed", value: segments.counts.lapsed, tone: "bg-gold" },
            {
              label: "Never ordered",
              value: segments.counts.never,
              tone: "bg-charcoal-soft",
            },
          ]}
        />
      </Card>

      {segments.lapsed.length > 0 && (
        <Card className="mt-5 p-4">
          <h2 className="flex items-center gap-2 font-display text-lg font-700 text-charcoal">
            <HeartCrack size={17} className="text-gold" /> Worth a message
          </h2>
          <p className="mb-3 mt-1 text-[11px] text-charcoal-soft">
            {segments.lapsed.length} customer
            {segments.lapsed.length === 1 ? " has" : "s have"} ordered before but
            nothing in the last {segments.lapseWeeks} weeks. Highest spenders
            first.
          </p>
          <ul className="flex flex-col gap-1.5">
            {segments.lapsed.slice(0, 10).map((row) => (
              <li
                key={row.uid}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-cream-deep/60 pb-1.5 last:border-0"
              >
                <Link
                  href={`/admin/customers/${row.uid}`}
                  className="font-600 text-charcoal hover:text-tomato"
                >
                  {row.name}
                </Link>
                <span className="text-xs text-charcoal-soft">
                  last ordered{" "}
                  {row.lastOrderWeek ? formatBaliDay(row.lastOrderWeek) : "—"} ·{" "}
                  <b className="font-700 tabular-nums text-charcoal">
                    {formatIdr(row.lifetimeIdr)}
                  </b>{" "}
                  lifetime
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-5 p-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-display text-lg font-700 text-charcoal">
            <Users size={17} className="text-tomato" /> Customers
          </h2>
          <Button size="sm" onClick={downloadCsv} icon={<Download size={14} />}>
            Export CSV
          </Button>
        </div>
        <p className="mb-3 text-[11px] text-charcoal-soft">
          Orders, meals, average and spend cover {range.label.toLowerCase()}.
          Lifetime and segment cover every order read.
        </p>
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
    </>
  );
}
