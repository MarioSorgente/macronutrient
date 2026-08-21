import type { RestaurantConfig } from "@/lib/storage/types";

/**
 * When a week stops being editable.
 *
 * This module is imported by both the browser (to show a deadline) and the
 * Cloud Function (to enforce one). Two implementations would eventually
 * disagree, and the one that disagreed would either reject an order the UI
 * promised was fine, or accept one after the kitchen had bought its stock.
 *
 * Everything is computed in the restaurant's own timezone. Bali is fixed UTC+8
 * with no daylight saving, but the offset is derived rather than assumed so a
 * second location does not silently break.
 */

/** Milliseconds a zone is ahead of UTC at a given instant. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  // `hour` comes back as 24 at midnight under hour12:false in some engines.
  const hour = get("hour") % 24;

  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second")
  );
  return asIfUtc - at.getTime();
}

/**
 * Turns a wall-clock date and time in `timeZone` into a real instant.
 *
 * Two passes: the first guesses using the offset at the naive instant, the
 * second re-derives it at the corrected one. That second pass only matters
 * near a DST transition, which Bali does not have — but it costs nothing and
 * makes the function correct anywhere.
 */
export function zonedToInstant(
  isoDate: string,
  time: string,
  timeZone: string
): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);

  const firstPass = naive - zoneOffsetMs(new Date(naive), timeZone);
  const secondPass = naive - zoneOffsetMs(new Date(firstPass), timeZone);
  return new Date(secondPass);
}

/** Adds whole days to a yyyy-mm-dd calendar date, in UTC to avoid drift. */
function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export interface CutoffConfig {
  timezone: string;
  /** 0 = Monday .. 6 = Sunday, within the week *before* the ordered week. */
  cutoffDay: number;
  /** "18:00", restaurant wall-clock. */
  cutoffTime: string;
}

/**
 * The instant orders close for the week beginning `weekStartDate` (a Monday).
 *
 * The deadline sits in the week *before* the one being ordered — the kitchen
 * needs the list before it starts cooking, not during. With the default
 * Sunday 18:00 that is the evening before the week opens.
 */
export function cutoffFor(
  weekStartDate: string,
  config: CutoffConfig
): Date {
  const precedingMonday = addDays(weekStartDate, -7);
  const cutoffDate = addDays(precedingMonday, config.cutoffDay);
  return zonedToInstant(cutoffDate, config.cutoffTime, config.timezone);
}

export interface CutoffState {
  at: Date;
  passed: boolean;
  msRemaining: number;
}

export function cutoffState(
  weekStartDate: string,
  config: CutoffConfig,
  now: Date = new Date()
): CutoffState {
  const at = cutoffFor(weekStartDate, config);
  const msRemaining = at.getTime() - now.getTime();
  return { at, passed: msRemaining <= 0, msRemaining };
}

/** Narrows a full config to just what the cutoff needs. */
export function cutoffConfigOf(config: RestaurantConfig): CutoffConfig {
  return {
    timezone: config.timezone,
    cutoffDay: config.cutoffDay,
    cutoffTime: config.cutoffTime,
  };
}

/** "2 days, 4 hours" — for the countdown next to the submit button. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "closed";
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
