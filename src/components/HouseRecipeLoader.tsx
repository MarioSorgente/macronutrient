"use client";

import { useEffect } from "react";
import { useHouseRecipes } from "@/store/houseRecipes";

/**
 * Loads Negrita's house recipes once per session and applies them as overrides
 * over the bundled estimates. Keep this beside the content that needs the
 * overrides: mounting it in the app shell makes unrelated routes pay for the
 * request.
 */
export default function HouseRecipeLoader({
  enabled = true,
}: {
  enabled?: boolean;
}) {
  const load = useHouseRecipes((s) => s.load);
  const loaded = useHouseRecipes((s) => s.loaded);

  useEffect(() => {
    if (enabled && !loaded) void load();
  }, [enabled, loaded, load]);

  return null;
}
