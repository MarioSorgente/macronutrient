import type { Role } from "@/lib/storage/types";

export const ROLE_LABELS = {
  client: "Customer",
  restaurant: "Staff",
  admin: "Owner",
} satisfies Record<Role, string>;

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

/** The restaurant role is the concrete, day-to-day kitchen operator. */
export function canUseKitchen(role: Role | null): boolean {
  return role === "restaurant";
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
  if (canUseKitchen(role)) return "/kitchen";
  if (canUseAdmin(role)) return "/admin";
  return "/plan";
}
