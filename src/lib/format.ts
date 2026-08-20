/** Display helpers — keep rounding consistent across the app. */

/** Round to a whole number (used for kcal and grams display). */
export function round0(n: number): string {
  return Math.round(n).toLocaleString("en-US");
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

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
