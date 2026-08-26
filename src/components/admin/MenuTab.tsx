"use client";

import { useMemo } from "react";
import { UtensilsCrossed } from "lucide-react";
import { fulfilmentMix, menuPerformance, slotMix, type MenuRow } from "@/lib/orderStats";
import type { PeriodRange } from "@/lib/orderStats";
import { formatIdr } from "@/lib/pricing";
import type { Order } from "@/lib/storage/types";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ShareBar from "@/components/ui/ShareBar";
import StatTile from "@/components/ui/StatTile";
import DataTable, { type Column } from "@/components/ui/DataTable";

/** Colours cycled through the slot bar, in the order slots come back. */
const SLOT_TONES = ["bg-tomato", "bg-basil", "bg-gold", "bg-charcoal", "bg-tomato-dark"];

/** What sells, in what slot, and how it reaches people. */
export default function MenuTab({
  orders,
  range,
}: {
  orders: Order[];
  range: PeriodRange;
}) {
  const dishes = useMemo(() => menuPerformance(orders), [orders]);
  const slots = useMemo(() => slotMix(orders), [orders]);
  const fulfilment = useMemo(() => fulfilmentMix(orders), [orders]);

  const top = dishes[0];
  const servings = dishes.reduce((n, row) => n + row.servings, 0);

  const columns: Column<MenuRow>[] = [
    {
      key: "name",
      header: "Dish",
      cell: (r) => <span className="font-600 text-charcoal">{r.name}</span>,
      sortBy: (r) => r.name.toLowerCase(),
    },
    {
      key: "slot",
      header: "Slot",
      cell: (r) => r.slot || "—",
      sortBy: (r) => r.slot,
    },
    {
      key: "servings",
      header: "Servings",
      cell: (r) => r.servings,
      sortBy: (r) => r.servings,
      align: "right",
    },
    {
      key: "share",
      header: "Share",
      cell: (r) => `${r.sharePct}%`,
      sortBy: (r) => r.sharePct,
      align: "right",
    },
    {
      key: "revenue",
      header: "Revenue",
      cell: (r) => formatIdr(r.revenueIdr),
      sortBy: (r) => r.revenueIdr,
      align: "right",
    },
    {
      key: "customers",
      header: "Customers",
      cell: (r) => r.customers,
      sortBy: (r) => r.customers,
      align: "right",
    },
  ];

  if (dishes.length === 0) {
    return (
      <EmptyState
        icon={<UtensilsCrossed size={22} />}
        title="Nothing ordered in this period"
        hint="Widen the period, or wait for the first week to come in."
      />
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Dishes ordered"
          value={String(dishes.length)}
          hint="distinct names"
        />
        <StatTile label="Servings" value={String(servings)} hint={range.label} />
        <StatTile
          label="Best seller"
          value={top?.name ?? "—"}
          hint={top ? `${top.servings} servings · ${top.sharePct}%` : undefined}
          tone="tomato"
          className="col-span-2"
        />
      </div>

      <Card className="mt-5 p-4">
        <h2 className="font-display text-lg font-700 text-charcoal">
          Menu performance
        </h2>
        <p className="mb-3 mt-1 text-[11px] text-charcoal-soft">
          Revenue is the price actually charged for those servings. Customers is
          how many different people ordered it — a big number from one household
          is a regular, not a hit. Dishes are grouped by the name on the order,
          so a dish renamed on the menu appears as two rows.
        </p>
        <DataTable
          rows={dishes}
          columns={columns}
          rowKey={(r) => r.name}
          initialSort={{ key: "servings", dir: "desc" }}
        />
      </Card>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Card className="p-4">
          <h2 className="font-display text-lg font-700 text-charcoal">
            Which slots
          </h2>
          <p className="mb-3 mt-1 text-[11px] text-charcoal-soft">
            Servings per meal slot. Slots are whatever customers named them in
            their own plan.
          </p>
          <ShareBar
            slices={slots.map((slice, i) => ({
              label: slice.label,
              value: slice.count,
              tone: SLOT_TONES[i % SLOT_TONES.length],
            }))}
          />
        </Card>

        <Card className="p-4">
          <h2 className="font-display text-lg font-700 text-charcoal">
            Pickup or delivery
          </h2>
          <p className="mb-3 mt-1 text-[11px] text-charcoal-soft">
            Meals by how they reach people. Chosen per day, so one order can
            count towards both.
          </p>
          <ShareBar
            slices={fulfilment.map((slice) => ({
              label: slice.label,
              value: slice.count,
              tone: slice.key === "delivery" ? "bg-gold" : "bg-basil",
            }))}
          />
        </Card>
      </div>
    </>
  );
}
