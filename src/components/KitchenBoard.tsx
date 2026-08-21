"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bike,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  Printer,
  ShoppingBag,
  UtensilsCrossed,
} from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { listPrepTasks, setPrepStatus, watchPrepTasks } from "@/lib/storage/orders";
import { miseEnPlace } from "@/lib/orders";
import { authErrorMessage } from "@/lib/auth/errors";
import { BALI_LABEL, baliToday, formatBaliDay, round0 } from "@/lib/format";
import type { PrepStatus, PrepTask } from "@/lib/storage/types";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import StatTile from "@/components/ui/StatTile";
import SegmentedToggle from "@/components/SegmentedToggle";
import { PrepStatusBadge } from "@/components/OrderStatusBadge";
import { cn } from "@/components/ui/cn";

type GroupBy = "time" | "customer" | "dish";

/** The order a task moves through, and what the button offers next. */
const NEXT: Record<PrepStatus, PrepStatus | null> = {
  todo: "prepping",
  prepping: "ready",
  ready: "done",
  done: null,
};

const ADVANCE_LABEL: Record<PrepStatus, string> = {
  todo: "Start",
  prepping: "Ready",
  ready: "Handed over",
  done: "Done",
};

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * One day of kitchen work.
 *
 * Grouped by when things have to be ready rather than by customer or order,
 * because the kitchen's real question is "what is next out of the pass". The
 * other groupings are there for the moments when it is not — packing one
 * person's bag, or batching the same dish across several orders.
 */
export default function KitchenBoard({ date }: { date?: string }) {
  const { user } = useAuth();
  const day = date ?? baliToday();

  const [tasks, setTasks] = useState<PrepTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("time");

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    setLoading(true);
    setError(null);

    watchPrepTasks(
      day,
      (next) => {
        if (!active) return;
        setTasks(next);
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
      .catch((cause) => {
        if (!active) return;
        // A live listener needs an index and permissions; fall back to a plain
        // read so a missing index degrades to a static board, not a blank one.
        listPrepTasks(day)
          .then((loaded) => active && setTasks(loaded))
          .catch(() => active && setError(authErrorMessage(cause)))
          .finally(() => active && setLoading(false));
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [day]);

  const counts = useMemo(() => {
    const by = { todo: 0, prepping: 0, ready: 0, done: 0 };
    let delivery = 0;
    for (const task of tasks) {
      by[task.status] += 1;
      if (task.mode === "delivery") delivery += 1;
    }
    return { ...by, delivery, pickup: tasks.length - delivery };
  }, [tasks]);

  const shopping = useMemo(
    () => miseEnPlace(tasks.filter((t) => t.status !== "done")),
    [tasks]
  );

  const groups = useMemo(() => groupTasks(tasks, groupBy), [tasks, groupBy]);

  const advance = useCallback(
    async (task: PrepTask) => {
      const next = NEXT[task.status];
      if (!next) return;
      try {
        await setPrepStatus(task.id, next, user?.uid ?? "");
      } catch (cause) {
        setError(authErrorMessage(cause));
      }
    },
    [user]
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Day navigation */}
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
            {day === baliToday() ? "Today" : formatBaliDay(day)}
          </h1>
          <p className="mt-1 text-sm text-charcoal-soft">
            {formatBaliDay(day)} · {BALI_LABEL}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/kitchen/${addDays(day, -1)}`}
            aria-label="Previous day"
            className="grid h-9 w-9 place-items-center rounded-lg border border-cream-deep bg-white text-charcoal-soft hover:text-charcoal"
          >
            <ChevronLeft size={16} />
          </Link>
          <Link
            href="/kitchen"
            className="rounded-lg border border-cream-deep bg-white px-3 py-2 text-sm font-600 text-charcoal"
          >
            Today
          </Link>
          <Link
            href="/kitchen/orders"
            className="rounded-lg border border-cream-deep bg-white px-3 py-2 text-sm font-600 text-charcoal"
          >
            Orders
          </Link>
          <Link
            href={`/kitchen/${addDays(day, 1)}`}
            aria-label="Next day"
            className="grid h-9 w-9 place-items-center rounded-lg border border-cream-deep bg-white text-charcoal-soft hover:text-charcoal"
          >
            <ChevronRight size={16} />
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg border border-cream-deep bg-white px-3 py-2 text-sm font-600 text-charcoal"
          >
            <Printer size={15} /> Print
          </button>
        </div>
      </div>

      {/* Counts */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="To prep" value={String(counts.todo)} tone="tomato" />
        <StatTile label="Prepping" value={String(counts.prepping)} tone="gold" />
        <StatTile label="Ready" value={String(counts.ready)} tone="basil" />
        <StatTile
          label="Pickup / delivery"
          value={`${counts.pickup} / ${counts.delivery}`}
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

      {loading ? (
        <p className="text-sm text-charcoal-soft">Loading the board…</p>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<ChefHat size={22} />}
          title="Nothing to prepare"
          hint={`No meals are ordered for ${formatBaliDay(day)}.`}
        />
      ) : (
        <>
          {/* Mise en place */}
          {shopping.length > 0 && (
            <Card className="mb-5 p-4">
              <h2 className="flex items-center gap-2 font-display text-lg font-700 text-charcoal">
                <UtensilsCrossed size={17} className="text-tomato" /> Mise en place
              </h2>
              <p className="mt-0.5 text-xs text-charcoal-soft">
                Everything still to prepare today, by ingredient.
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

          <div className="no-print mb-3">
            <SegmentedToggle<GroupBy>
              ariaLabel="Group the board by"
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: "time", label: "By time" },
                { value: "customer", label: "By customer" },
                { value: "dish", label: "By dish" },
              ]}
            />
          </div>

          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <section key={group.key}>
                <h2 className="mb-2 border-b border-cream-deep pb-1 font-display text-lg font-700 text-charcoal">
                  {group.label}
                  <span className="ml-2 text-sm font-500 text-charcoal-soft">
                    {group.tasks.length} item
                    {group.tasks.length === 1 ? "" : "s"}
                  </span>
                </h2>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.tasks.map((task) => (
                    <li key={task.id}>
                      <Card
                        className={cn(
                          "flex h-full flex-col p-3",
                          task.status === "done" && "opacity-55"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-600 text-charcoal">
                              {task.mealName}
                              {task.servings !== 1 && (
                                <span className="text-charcoal-soft">
                                  {" "}
                                  ×{task.servings}
                                </span>
                              )}
                            </p>
                            <p className="text-[11px] uppercase tracking-wide text-charcoal-soft">
                              {task.slot} · {task.customerName}
                            </p>
                          </div>
                          <PrepStatusBadge status={task.status} />
                        </div>

                        <p className="mt-1 flex items-center gap-1.5 text-xs text-charcoal-soft">
                          {task.mode === "delivery" ? (
                            <Bike size={13} />
                          ) : (
                            <ShoppingBag size={13} />
                          )}
                          {task.mode === "delivery" ? "Deliver" : "Pickup"} by{" "}
                          <b className="font-700 text-charcoal">{task.readyBy}</b>
                        </p>
                        {task.address && (
                          <p className="mt-0.5 truncate text-[11px] text-charcoal-soft">
                            {task.address}
                          </p>
                        )}

                        <ul className="mt-2 flex flex-col gap-0.5 border-t border-cream-deep pt-2 text-xs tabular-nums text-charcoal-soft">
                          {task.items.map((item) => (
                            <li
                              key={item.ingredientId}
                              className="flex justify-between gap-2"
                            >
                              <span className="truncate">{item.name}</span>
                              <span className="shrink-0">
                                {round0(item.grams * task.servings)} g
                              </span>
                            </li>
                          ))}
                        </ul>

                        {NEXT[task.status] && (
                          <button
                            type="button"
                            onClick={() => advance(task)}
                            className="no-print mt-3 w-full rounded-xl bg-tomato px-3 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
                          >
                            {ADVANCE_LABEL[task.status]}
                          </button>
                        )}
                      </Card>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

interface TaskGroup {
  key: string;
  label: string;
  tasks: PrepTask[];
}

function groupTasks(tasks: PrepTask[], by: GroupBy): TaskGroup[] {
  const buckets = new Map<string, TaskGroup>();

  for (const task of tasks) {
    const key =
      by === "time" ? task.readyBy : by === "customer" ? task.customerName : task.mealName;
    const label = by === "time" ? `By ${task.readyBy}` : key;
    const existing = buckets.get(key);
    if (existing) existing.tasks.push(task);
    else buckets.set(key, { key, label, tasks: [task] });
  }

  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}
