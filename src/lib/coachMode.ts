"use client";

import { useCallback, useEffect, useState } from "react";

export type PlannerMode = "manual" | "coach";

const KEY = "mamma-calories:planner-mode";

/**
 * Manual vs coach view of the same client data. There is no separate coach
 * record — the mode only changes what the screen emphasises, so a coach and a
 * planner never work on diverging copies of a plan.
 *
 * Read from the URL (?mode=coach, which is what the "For coaches" nav link
 * points at), falling back to the last mode used on this device. The URL is read
 * directly rather than via useSearchParams so statically rendered routes don't
 * need a Suspense boundary.
 */
export function usePlannerMode(): [PlannerMode, (mode: PlannerMode) => void] {
  const [mode, setMode] = useState<PlannerMode>("manual");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("mode");
    if (fromUrl === "coach" || fromUrl === "manual") {
      setMode(fromUrl);
      window.localStorage.setItem(KEY, fromUrl);
      return;
    }
    const stored = window.localStorage.getItem(KEY);
    if (stored === "coach" || stored === "manual") setMode(stored);
  }, []);

  const update = useCallback((next: PlannerMode) => {
    setMode(next);
    window.localStorage.setItem(KEY, next);
    const url = new URL(window.location.href);
    if (next === "coach") {
      url.searchParams.set("mode", "coach");
    } else {
      url.searchParams.delete("mode");
    }
    window.history.replaceState({}, "", url);
  }, []);

  return [mode, update];
}
