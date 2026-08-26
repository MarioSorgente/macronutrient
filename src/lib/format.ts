/** Display helpers — keep rounding and time zones consistent across the app. */

/** Round to a whole number (used for kcal and grams display). */
export function round0(n: number): string {
  const rounded = Math.round(n);
  return (Object.is(rounded, -0) ? 0 : rounded).toLocaleString("en-US");
}

/** Format user-facing macro grams as a whole number. Never renders negative zero. */
export function formatMacroGrams(n: number): string {
  const rounded = Math.round(n);
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** Format a fractional share as a whole percentage for user-facing text. */
export function formatPercentageShare(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * One decimal place, still a number — for a field someone types into, where
 * `round1`'s trimmed string would be a value the input cannot hold.
 */
export function roundedToTenth(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

/** Round to one decimal place, trimming a trailing ".0" (used for macros). */
export function round1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Format a gram amount for editable fields (no thousands separator). */
export function grams(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// --- Bali time ---------------------------------------------------------------
//
// The restaurant runs on Bali time and nothing else. A prep day, an order
// cutoff and a pickup slot are all Bali wall-clock concepts, so every date the
// app renders or compares goes through the helpers below. Calling
// `new Date().toLocaleDateString()` anywhere else would silently show a staff
// member on a UTC laptop the wrong day's prep list.

/** IANA zone for Bali. Fixed UTC+8 year-round — WITA has no daylight saving. */
export const BALI_TZ = "Asia/Makassar";

/** Shown next to any time the user could otherwise read in their own zone. */
export const BALI_LABEL = "Bali time (WITA, UTC+8)";

/** Matches the date style the app already used everywhere ("Aug 21, 2026"). */
const LOCALE = "en-US";

/**
 * Parses a stored calendar date without allowing JavaScript's date
 * normalization (for example, turning February 31 into March 3).
 */
export function parseCalendarDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed;
}

/** True for a plain calendar date ("2026-08-24") rather than a full instant. */
function isDateOnly(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso);
}

/**
 * Formats an ISO string in Bali time.
 *
 * A date-only string is a calendar date with no instant attached, so it is
 * formatted in UTC — otherwise "2026-08-24" would parse as UTC midnight and
 * render as the 23rd for anyone west of Greenwich.
 */
export function formatBali(
  iso: string,
  opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" }
): string {
  try {
    const zone = isDateOnly(iso) ? "UTC" : BALI_TZ;
    return new Intl.DateTimeFormat(LOCALE, { ...opts, timeZone: zone }).format(
      new Date(isDateOnly(iso) ? `${iso}T00:00:00Z` : iso)
    );
  } catch {
    return iso;
  }
}

/** "Mon, Aug 24" — the day label used across the planner and kitchen board. */
export function formatBaliDay(iso: string): string {
  return formatBali(iso, { weekday: "short", month: "short", day: "numeric" });
}

/** "Aug 24, 2026, 18:00" — for cutoffs, receipts and audit timestamps. */
export function formatBaliDateTime(iso: string): string {
  return formatBali(iso, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Today's yyyy-mm-dd **in Bali**, not in the viewer's zone. */
export function baliToday(): string {
  return baliDateOf(new Date());
}

/** The Bali calendar date (yyyy-mm-dd) an instant falls on. */
export function baliDateOf(at: Date): string {
  // en-CA renders as yyyy-mm-dd, which is exactly the shape we store.
  return new Intl.DateTimeFormat("en-CA", { timeZone: BALI_TZ }).format(at);
}

/**
 * Adds whole days to a yyyy-mm-dd calendar date.
 *
 * Done in UTC so the arithmetic never crosses a local midnight; Bali has no
 * DST, so a Bali day is always exactly 24 hours.
 */
export function addDays(isoDate: string, days: number): string {
  const parsed = parseCalendarDate(isoDate);
  if (!parsed) throw new RangeError(`Invalid calendar date: ${isoDate}`);
  const t = parsed.valueOf() + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 0 = Monday .. 6 = Sunday, matching `Assignment.day`. */
export function dayIndex(isoDate: string): number {
  const parsed = parseCalendarDate(isoDate);
  if (!parsed) throw new RangeError(`Invalid calendar date: ${isoDate}`);
  return (parsed.getUTCDay() + 6) % 7;
}

/** Monday of the Bali week containing `isoDate` (defaults to today in Bali). */
export function baliWeekStart(isoDate: string = baliToday()): string {
  return addDays(isoDate, -dayIndex(isoDate));
}

/**
 * Kept for existing call sites. Delegates to `formatBali` so a date-only
 * string can no longer render as the previous day in a western time zone.
 */
export function formatDate(iso: string): string {
  return formatBali(iso);
}
