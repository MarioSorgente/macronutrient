import type { Role } from "@/lib/storage/types";
import { canManageHouseItems, canUseAdmin, canUseKitchen } from "@/lib/roles";

/**
 * What each route requires, in one table.
 *
 * Protection used to be per-page: `RequireRole` on two layouts, an inline
 * `SignInPrompt` on three screens, and nothing at all on the planner. Whether a
 * route was protected therefore depended on whoever wrote it remembering to
 * protect it, and `/plan` — the whole product — was never protected at all.
 *
 * This is the single source of truth `RouteGuard` reads. It is a pure function
 * so the policy can be tested without a browser, and it is deny-by-default: a
 * route nobody thought about requires an account rather than being public.
 */

export type RouteAccess =
  | { kind: "public" }
  | { kind: "auth" }
  | { kind: "role"; allow: Role[]; staffIntent: boolean };

const CLIENT: Role[] = ["client"];
const ROLES: Role[] = ["client", "restaurant", "admin"];
const KITCHEN: Role[] = ROLES.filter(canUseKitchen);
const HOUSE_ITEMS: Role[] = ROLES.filter(canManageHouseItems);
const ADMIN: Role[] = ROLES.filter(canUseAdmin);

/**
 * The complete public surface.
 *
 * `/__/auth` is Firebase's own handler path for sign-in redirects and email
 * action links; gating it would break the flows that lead back into the app.
 */
const PUBLIC_EXACT = new Set(["/", "/login", "/signup", "/reset"]);
const PUBLIC_PREFIXES = ["/__/auth"];

/** Screens belonging to the diner's planning and ordering journey. */
const CLIENT_PREFIXES = ["/plan", "/report", "/orders"];

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Trailing slashes and casing must not be a way around the table. */
function normalise(pathname: string): string {
  const path = (pathname || "/").split("?")[0].split("#")[0].toLowerCase();
  if (path.length > 1 && path.endsWith("/")) return path.replace(/\/+$/, "") || "/";
  return path;
}

export function policyFor(pathname: string): RouteAccess {
  const path = normalise(pathname);

  if (PUBLIC_EXACT.has(path)) return { kind: "public" };
  if (PUBLIC_PREFIXES.some((prefix) => matches(path, prefix))) {
    return { kind: "public" };
  }
  if (matches(path, "/kitchen"))
    return { kind: "role", allow: KITCHEN, staffIntent: true };
  // This shared workspace must be checked before the broader admin prefix.
  if (matches(path, "/admin/house-items"))
    return { kind: "role", allow: HOUSE_ITEMS, staffIntent: true };
  if (matches(path, "/admin"))
    return { kind: "role", allow: ADMIN, staffIntent: true };
  if (CLIENT_PREFIXES.some((prefix) => matches(path, prefix))) {
    return { kind: "role", allow: CLIENT, staffIntent: false };
  }
  return { kind: "auth" };
}

/** Convenience for the guard and its tests. */
export function isPublicRoute(pathname: string): boolean {
  return policyFor(pathname).kind === "public";
}
