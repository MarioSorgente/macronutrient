/**
 * Helpers shared by the integration and end-to-end suites.
 *
 * They live in separate Vitest/Playwright projects with no common harness, so
 * anything both need goes here rather than being written out twice and drifting.
 */

/** A Monday `weeks` weeks from the current one, as yyyy-mm-dd. */
export function mondayAhead(weeks: number): string {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dow = (new Date(midnight).getUTCDay() + 6) % 7; // 0 = Monday
  return new Date(midnight - dow * 86_400_000 + weeks * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
