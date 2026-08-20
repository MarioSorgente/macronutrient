"use client";

import { useEffect } from "react";
import { useHouseRecipes } from "@/store/houseRecipes";

/**
 * Loads Negrita's house recipes once per session and applies them as overrides
 * over the bundled estimates. Mounted in the root layout so every route —
 * builder, clients, reports — calculates from the same corrected values.
 */
export default function HouseRecipeLoader() {
  const load = useHouseRecipes((s) => s.load);
  const loaded = useHouseRecipes((s) => s.loaded);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  return null;
}
