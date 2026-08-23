"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bike, Clock, Send, ShoppingBag } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { readStoredProfile } from "@/lib/auth/profile";
import { useRepos } from "@/lib/storage/repos";
import { loadCurrentPlan } from "@/lib/currentPlan";
import { byId, DAY_NAMES } from "@/lib/clients";
import {
  DEFAULT_FULFILMENT,
  buildOrderDays,
  emptySlots,
  fulfilmentProblems,
  summarizeOrder,
  weekStartDate,
  type FulfilmentByDay,
} from "@/lib/orders";
import { cutoffConfigOf, cutoffState, formatRemaining } from "@/lib/cutoff";
import { loadRestaurantConfig, submitWeek } from "@/lib/storage/orders";
import { authErrorMessage } from "@/lib/auth/errors";
import { BALI_LABEL, formatBaliDay } from "@/lib/format";
import { formatIdr } from "@/lib/pricing";
import { round0 } from "@/lib/format";
import type {
  Dish,
  Fulfilment,
  FulfilmentMode,
  Plan,
  RestaurantConfig,
} from "@/lib/storage/types";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import SignInPrompt from "@/components/SignInPrompt";
import Input from "@/components/ui/Input";
import MacroChips from "@/components/MacroChips";
import SegmentedToggle from "@/components/SegmentedToggle";
import { useToast } from "@/components/ui/Toast";

/**
 * Review a week and send it to the kitchen.
 *
 * Fulfilment is chosen per day rather than per week because that is how people
 * actually eat — collecting lunch on the way past on a workday, having Sunday
 * delivered. Gaps in the week are shown but never block: the app's rule
 * throughout is that an empty slot is reported, not quietly padded.
 */
export default function SubmitWeek() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const repos = useRepos();
  const { show } = useToast();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [config, setConfig] = useState<RestaurantConfig | null>(null);
  const [week, setWeek] = useState(1);
  const [fulfilment, setFulfilment] = useState<FulfilmentByDay>({});
  /** The customer's saved delivery address, used to pre-fill a delivery day. */
  const [defaultAddress, setDefaultAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (repos.loading) return;
    let active = true;

    Promise.all([
      loadCurrentPlan(repos.plans, repos.uid),
      repos.dishes.list().catch(() => [] as Dish[]),
      loadRestaurantConfig(),
    ])
      .then(([loadedPlan, loadedDishes, loadedConfig]) => {
        if (!active) return;
        setPlan(loadedPlan);
        setDishes(loadedDishes);
        setConfig(loadedConfig);
        const firstUnsent =
          Array.from({ length: loadedPlan.weekCount }, (_, i) => i + 1).find(
            (w) => !loadedPlan.submittedWeeks?.includes(w)
          ) ?? 1;
        setWeek(firstUnsent);
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
  }, [repos]);

  const dishMap = useMemo(() => byId(dishes), [dishes]);

  const days = useMemo(
    () => (plan ? buildOrderDays(plan, week, dishMap, fulfilment) : []),
    [plan, week, dishMap, fulfilment]
  );
  const summary = useMemo(() => summarizeOrder(days), [days]);
  const gaps = useMemo(
    () => (plan ? emptySlots(plan, week) : []),
    [plan, week]
  );
  const problems = useMemo(() => fulfilmentProblems(days), [days]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void (async () => {
      const profile = await readStoredProfile(user.uid);
      if (active && profile?.defaultAddress) setDefaultAddress(profile.defaultAddress);
    })().catch(() => {
      // A missing default address is not worth blocking the submit screen.
    });
    return () => {
      active = false;
    };
  }, [user]);

  const cutoff = useMemo(() => {
    if (!plan || !config) return null;
    return cutoffState(weekStartDate(plan, week), cutoffConfigOf(config));
  }, [plan, config, week]);

  const setDay = useCallback(
    (day: number, patch: Partial<Fulfilment>) => {
      setFulfilment((current) => {
        const next: Fulfilment = {
          ...DEFAULT_FULFILMENT,
          ...current[day],
          ...patch,
        };
        // Switching a day to delivery pre-fills the address saved on the
        // profile, so it is typed once rather than every week. A manual edit
        // always wins: this only fills a blank.
        if (next.mode === "delivery" && !next.address?.trim() && defaultAddress) {
          next.address = defaultAddress;
        }
        return { ...current, [day]: next };
      });
    },
    [defaultAddress]
  );

  /** Most people want the same arrangement every day; make that one click. */
  const applyToAll = useCallback(() => {
    setFulfilment((current) => {
      const first = days[0] ? current[dayIndexOf(days[0].date, plan, week)] : undefined;
      const template = first ?? DEFAULT_FULFILMENT;
      const next: FulfilmentByDay = {};
      for (let day = 0; day < 7; day += 1) next[day] = { ...template };
      return next;
    });
  }, [days, plan, week]);

  async function send() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const result = await submitWeek(plan.id, week, fulfilment);
      show(`Week ${week} is with the kitchen.`);
      router.push(`/orders/${result.orderId}`);
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  if (loading || authLoading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <p className="text-sm text-charcoal-soft">Loading your week…</p>
      </main>
    );
  }

  if (!plan) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={<AlertTriangle size={22} />}
          title="We could not load your plan"
          hint={error ?? "Try reloading the page."}
        />
      </main>
    );
  }

  // Signing in is required to submit, but only at the moment of submitting —
  // everything above this point works as a guest.
  if (!user) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <SignInPrompt
          icon={<Send size={22} />}
          title="Sign in to send this week to the kitchen"
          hint="Your plan stays on this device until you do, and moves to your account when you sign in."
          next="/plan/submit"
        />
      </main>
    );
  }

  const alreadySent = plan.submittedWeeks?.includes(week);
  const blocked =
    busy ||
    alreadySent ||
    days.length === 0 ||
    problems.length > 0 ||
    (cutoff?.passed ?? false) ||
    !(config?.acceptingOrders ?? true);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
        Send your week to the kitchen
      </h1>
      <p className="mt-1 text-sm text-charcoal-soft">
        Negrita will prep these meals for you, day by day.
      </p>

      {/* Week picker */}
      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {Array.from({ length: plan.weekCount }, (_, i) => i + 1).map((w) => {
          const sent = plan.submittedWeeks?.includes(w);
          return (
            <button
              key={w}
              type="button"
              onClick={() => setWeek(w)}
              className={
                "rounded-lg px-3 py-1.5 text-sm font-600 transition-colors " +
                (w === week
                  ? "bg-tomato text-cream"
                  : "border border-cream-deep bg-white text-charcoal-soft hover:text-charcoal")
              }
            >
              Week {w}
              {sent && " ✓"}
            </button>
          );
        })}
      </div>

      {/* Deadline */}
      {cutoff && (
        <div
          className={
            "mt-4 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm " +
            (cutoff.passed
              ? "border-tomato-dark/30 bg-tomato-soft/20 text-tomato-dark"
              : "border-cream-deep bg-white text-charcoal")
          }
        >
          <Clock size={15} />
          {cutoff.passed ? (
            <span className="font-600">
              Orders for week {week} closed on{" "}
              {formatBaliDay(cutoff.at.toISOString())}.
            </span>
          ) : (
            <span>
              Closes{" "}
              <b className="font-700">
                {formatBaliDay(cutoff.at.toISOString())}
                {config ? `, ${config.cutoffTime}` : ""}
              </b>{" "}
              — {formatRemaining(cutoff.msRemaining)} left
              <span className="text-charcoal-soft"> · {BALI_LABEL}</span>
            </span>
          )}
        </div>
      )}

      {days.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={<AlertTriangle size={22} />}
          title="Nothing planned for this week"
          hint="Add some meals before sending it over."
          action={
            <Link
              href="/plan"
              className="inline-flex rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
            >
              Back to the planner
            </Link>
          }
        />
      ) : (
        <>
          {/* Per-day fulfilment */}
          <div className="mt-6 flex items-center justify-between">
            <h2 className="font-display text-lg font-700 text-charcoal">
              How you want each day
            </h2>
            <Button size="sm" onClick={applyToAll}>
              Apply the first day to all
            </Button>
          </div>

          <ul className="mt-3 flex flex-col gap-3">
            {days.map((day) => {
              const index = dayIndexOf(day.date, plan, week);
              const choice = fulfilment[index] ?? DEFAULT_FULFILMENT;
              return (
                <Card key={day.date} className="p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <h3 className="font-600 text-charcoal">
                        {DAY_NAMES[index]}
                      </h3>
                      <p className="text-xs text-charcoal-soft">
                        {formatBaliDay(day.date)} · {day.meals.length} meal
                        {day.meals.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className="text-sm font-600 tabular-nums text-charcoal">
                      {formatIdr(day.meals.reduce((n, m) => n + m.priceIdr, 0))}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <SegmentedToggle<FulfilmentMode>
                      ariaLabel={`How to get ${DAY_NAMES[index]}'s food`}
                      value={choice.mode}
                      onChange={(mode) => setDay(index, { mode })}
                      options={[
                        { value: "pickup", label: "Pickup", icon: <ShoppingBag size={14} /> },
                        { value: "delivery", label: "Delivery", icon: <Bike size={14} /> },
                      ]}
                    />
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-600 uppercase tracking-wide text-charcoal-soft">
                        Ready by ({BALI_LABEL})
                      </span>
                      <Input
                        type="time"
                        value={choice.time}
                        min={config?.serviceOpen}
                        max={config?.serviceClose}
                        onChange={(e) => setDay(index, { time: e.target.value })}
                        className="w-32"
                      />
                    </label>
                  </div>

                  {choice.mode === "delivery" && (
                    <label className="mt-3 flex flex-col gap-1">
                      <span className="text-[11px] font-600 uppercase tracking-wide text-charcoal-soft">
                        Deliver to
                      </span>
                      <Input
                        value={choice.address ?? ""}
                        placeholder="Street, villa or hotel"
                        onChange={(e) => setDay(index, { address: e.target.value })}
                        invalid={!choice.address?.trim()}
                      />
                    </label>
                  )}

                  <ul className="mt-3 flex flex-col gap-1 border-t border-cream-deep pt-2">
                    {day.meals.map((meal) => (
                      <li
                        key={meal.assignmentId}
                        className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                      >
                        <span className="text-charcoal">
                          <span className="text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
                            {meal.slot}
                          </span>{" "}
                          {meal.name}
                          {meal.servings !== 1 && ` ×${meal.servings}`}
                        </span>
                        <span className="tabular-nums text-charcoal-soft">
                          {round0(meal.totals.energy_kcal)} kcal
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </ul>

          {/* Totals */}
          <Card className="mt-5 p-4">
            <h2 className="font-display text-lg font-700 text-charcoal">
              The whole week
            </h2>
            <MacroChips macros={summary.totals} size="sm" className="mt-2" />
            <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-cream-deep pt-3 text-sm">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-charcoal-soft">
                  Meals
                </dt>
                <dd className="font-700 tabular-nums text-charcoal">
                  {summary.mealCount}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-charcoal-soft">
                  Days
                </dt>
                <dd className="font-700 tabular-nums text-charcoal">
                  {summary.dayCount}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-charcoal-soft">
                  Total
                </dt>
                <dd className="font-700 tabular-nums text-tomato">
                  {formatIdr(summary.priceIdr)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[11px] text-charcoal-soft">
              Payment is arranged with the restaurant — nothing is charged here.
            </p>
          </Card>

          {/* Anything worth knowing before sending */}
          {gaps.length > 0 && (
            <p className="mt-4 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-charcoal">
              <b className="font-700">{gaps.length} empty slot{gaps.length === 1 ? "" : "s"}</b>{" "}
              this week. You can still send it — the kitchen only prepares what
              is here.
            </p>
          )}
          {problems.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 rounded-xl border border-tomato-dark/30 bg-tomato-soft/20 px-3 py-2 text-sm font-600 text-tomato-dark">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          {alreadySent && (
            <p className="mt-3 rounded-xl border border-basil/30 bg-basil/10 px-3 py-2 text-sm font-600 text-basil">
              Week {week} has already been sent.{" "}
              <Link href="/orders" className="underline">
                See your orders
              </Link>
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="mt-3 rounded-xl border border-tomato-dark/30 bg-tomato-soft/20 px-3 py-2 text-sm font-600 text-tomato-dark"
            >
              {error}
            </p>
          )}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Link
              href="/plan"
              className="inline-flex items-center justify-center rounded-xl border border-cream-deep bg-white px-4 py-2 text-sm font-600 text-charcoal"
            >
              Keep editing
            </Link>
            <Button
              variant="primary"
              disabled={blocked}
              onClick={send}
              icon={<Send size={16} />}
            >
              {busy ? "Sending…" : `Send week ${week} to the kitchen`}
            </Button>
          </div>
        </>
      )}
    </main>
  );
}

/** Maps an order day's date back to its 0-6 index within the plan week. */
function dayIndexOf(date: string, plan: Plan | null, week: number): number {
  if (!plan) return 0;
  const start = weekStartDate(plan, week);
  const [sy, sm, sd] = start.split("-").map(Number);
  const [dy, dm, dd] = date.split("-").map(Number);
  const diff =
    (Date.UTC(dy, dm - 1, dd) - Date.UTC(sy, sm - 1, sd)) / 86_400_000;
  return Math.max(0, Math.min(6, Math.round(diff)));
}
