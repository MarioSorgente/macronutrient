"use client";

import { useEffect, useState } from "react";

/**
 * A clock that advances once a minute, for anything counting down to a deadline.
 *
 * `cutoffState` reads `new Date()` when nothing is passed to it, so a `useMemo`
 * over it is frozen at mount: the banner sits on "12m left" indefinitely and
 * never flips to "closed". The planner solved that with its own interval; the
 * submit screen, the one whose Send button the deadline actually gates, did not
 * — so it kept the button enabled past the cutoff and let the server refuse the
 * order instead.
 *
 * One hook, so the two screens cannot disagree about the time again. A minute is
 * the resolution the countdown is rendered at, so anything finer would re-render
 * for nothing.
 */
export function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  return now;
}
