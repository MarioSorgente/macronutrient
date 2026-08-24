/**
 * Building and sanitising the `?next=` and `?intent=` query strings.
 *
 * `next` is attacker-controllable: anyone can hand out a `/login?next=…` link.
 * It used to be read straight into `router.push`, which made every sign-in
 * screen an open redirect — a phishing page could send someone to a real
 * Mamma Calories login and have them land somewhere else entirely. Only
 * internal paths are accepted now, and everything is built through one helper
 * so a link cannot quietly drop the intent it was supposed to carry.
 */

/** Which of the two journeys a visitor said they were on. */
export type AuthIntent = "customer" | "staff";

/** Where a customer goes when no destination was asked for. */
export const DEFAULT_NEXT = "/plan";

export function isAuthIntent(value: unknown): value is AuthIntent {
  return value === "customer" || value === "staff";
}

export function readIntent(value: string | null | undefined): AuthIntent | null {
  return isAuthIntent(value) ? value : null;
}

/**
 * The path to return to after authenticating, or the fallback.
 *
 * Rejects anything that could leave this origin. `//evil.example` and
 * `/\evil.example` are the two that matter: browsers treat both as
 * protocol-relative URLs, so a naive "starts with a slash" check lets them
 * through. Parsing against a dummy base catches the rest.
 */
export function safeNext(
  raw: string | null | undefined,
  fallback: string = DEFAULT_NEXT
): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // A control character can smuggle a scheme past the checks above once the
  // browser has stripped it.
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;

  try {
    const url = new URL(value, "http://internal.invalid");
    if (url.origin !== "http://internal.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * The one place `/login` and `/signup` links are assembled.
 *
 * Three screens hand-built these, so a cross-link could preserve `next` and
 * lose `intent`, which is exactly how somebody who clicked "I work at Negrita"
 * ended up onboarded as a customer.
 */
export function authUrl(
  mode: "login" | "signup",
  { next, intent }: { next?: string | null; intent?: AuthIntent | null } = {}
): string {
  const params = new URLSearchParams();
  if (intent) params.set("intent", intent);
  if (next) {
    const safe = safeNext(next, "");
    if (safe) params.set("next", safe);
  }
  const query = params.toString();
  return query ? `/${mode}?${query}` : `/${mode}`;
}
