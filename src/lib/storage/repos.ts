"use client";

import { useMemo } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  getDishRepository,
  getHouseRecipeRepository,
  getPlanRepository,
} from "@/lib/storage";
import type {
  DishRepository,
  HouseRecipeRepository,
  PlanRepository,
} from "@/lib/storage/types";

export interface Repos {
  plans: PlanRepository;
  dishes: DishRepository;
  houseRecipes: HouseRecipeRepository;
  /** null while signed out — the plan lives on this device only. */
  uid: string | null;
  /** True until auth has reported, so callers can avoid a wrong-store read. */
  loading: boolean;
}

/**
 * The repositories for whoever is currently signed in.
 *
 * Components ask for this rather than calling a factory directly, so no screen
 * has to know whether it is reading a guest's device or a signed-in account.
 * `loading` matters: reading before auth resolves would hit the guest store and
 * then swap underneath the user.
 */
export function useRepos(): Repos {
  const { user, loading } = useAuth();
  const uid = user?.uid ?? null;

  return useMemo(
    () => ({
      plans: getPlanRepository(uid),
      dishes: getDishRepository(uid),
      houseRecipes: getHouseRecipeRepository(),
      uid,
      loading,
    }),
    [uid, loading]
  );
}
