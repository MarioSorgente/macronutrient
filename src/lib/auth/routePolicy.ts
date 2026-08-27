import type { Role } from "@/lib/storage/types";

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

const STAFF: Role[] = ["restaurant", "admin"];
const CLIENT: Role[] = ["client"];

/**
 * The complete public surface.
 *
 * `/__/auth` is Firebase's own handler path for sign-in redirects and email
 * action links; gating it would break the flows that lead back into the app.
 */
const PUBLIC_EXACT = new Set(["/", "/login", "/signup", "/reset"]);
const PUBLIC_PREFIXES = ["/__/auth"];

/** Staff areas. The admin-only screens keep their own stricter check inside. */
const STAFF_PREFIXES = ["/kitchen", "/admin"];

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
  if (STAFF_PREFIXES.some((prefix) => matches(path, prefix))) {
    return { kind: "role", allow: STAFF, staffIntent: true };
  }
  if (CLIENT_PREFIXES.some((prefix) => matches(path, prefix))) {
    return { kind: "role", allow: CLIENT, staffIntent: false };
  }
  return { kind: "auth" };
}

/** Convenience for the guard and its tests. */
export function isPublicRoute(pathname: string): boolean {
  return policyFor(pathname).kind === "public";
}
