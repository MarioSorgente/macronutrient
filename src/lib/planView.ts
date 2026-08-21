"use client";

import { useCallback, useEffect, useState } from "react";

export type PlanView = "day" | "week";

const VIEW_KEY = "mamma-calories:plan-view";
const PRICES_KEY = "mamma-calories:show-prices";

/**
 * Day-at-a-time vs the seven-column week overview.
 *
 * Defaults by screen: a 7-column grid is the wrong thing to open on a phone, so
 * mobile starts on the day view and desktop on the week. An explicit choice is
 * remembered and always wins afterwards.
 */
export function usePlanView(): [PlanView, (view: PlanView) => void] {
  const [view, setView] = useState<PlanView>("week");

  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_KEY);
    if (stored === "day" || stored === "week") {
      setView(stored);
      return;
    }
    const isNarrow = window.matchMedia("(max-width: 767px)").matches;
    setView(isNarrow ? "day" : "week");
  }, []);

  const update = useCallback((next: PlanView) => {
    setView(next);
    window.localStorage.setItem(VIEW_KEY, next);
  }, []);

  return [view, update];
}

/**
 * Whether cost is shown in the planner. Some people plan on budget as well as
 * macros; anyone who does not want the extra column can turn it off.
 */
export function useShowPrices(): [boolean, (show: boolean) => void] {
  const [showPrices, setShowPrices] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(PRICES_KEY);
    if (stored === "0") setShowPrices(false);
  }, []);

  const update = useCallback((next: boolean) => {
    setShowPrices(next);
    window.localStorage.setItem(PRICES_KEY, next ? "1" : "0");
  }, []);

  return [showPrices, update];
}
