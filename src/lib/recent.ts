"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "mamma-calories:recent-ingredients";
const MAX = 12;

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Tracks the ingredients this device reaches for most often. A kitchen builds
 * the same dishes repeatedly, so surfacing recents is the shortest path to a
 * common item.
 */
export function useRecentIngredients() {
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    setRecentIds(read());
  }, []);

  const remember = useCallback((ingredientId: string) => {
    const next = [ingredientId, ...read().filter((id) => id !== ingredientId)].slice(
      0,
      MAX
    );
    window.localStorage.setItem(KEY, JSON.stringify(next));
    setRecentIds(next);
  }, []);

  return { recentIds, remember };
}
