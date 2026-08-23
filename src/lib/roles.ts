import type { Role } from "@/lib/storage/types";

export const ROLE_LABELS = {
  client: "Customer",
  restaurant: "Staff",
  admin: "Owner",
} satisfies Record<Role, string>;

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role];
}
