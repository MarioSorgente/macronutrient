type ClassValue = string | false | null | undefined;

/**
 * Joins class names, dropping falsy values.
 *
 * Deliberately naive: it does not resolve conflicting Tailwind utilities, so
 * appending `text-sm` to a component that already sets `text-base` is decided
 * by stylesheet order, not by argument order. Every primitive here therefore
 * exposes variant props for the things a caller is likely to change, and
 * `className` is for additions (spacing, width), not overrides.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
