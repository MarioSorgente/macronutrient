import type { Role } from "@/lib/storage/types";

export const ROLE_LABELS = {
  client: "Customer",
  restaurant: "Staff",
  admin: "Owner",
} satisfies Record<Role, string>;

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

/**
 * The kitchen is the operator's daily workspace, and the owner's to oversee.
 *
 * Excluding the owner locked them out of their own pass entirely — no header
 * link and no route — while the order book, the prep board and every order
 * detail live there.
 */
export function canUseKitchen(role: Role | null): boolean {
  return role === "restaurant" || role === "admin";
}

/** House ingredients and recipes are shared by the operator and owner. */
export function canManageHouseItems(role: Role | null): boolean {
  return role === "restaurant" || role === "admin";
}

/** Owner administration is deliberately distinct from kitchen operation. */
export function canUseAdmin(role: Role | null): boolean {
  return role === "admin";
}

/** A signed-in role's useful landing page, also used for denied navigation. */
export function homeForRole(role: Role): string {
  // Admin first. The owner can use the kitchen as well, but their dashboard is
  // the more useful place to arrive.
  if (canUseAdmin(role)) return "/admin";
  if (canUseKitchen(role)) return "/kitchen";
  return "/plan";
}
