import "server-only";

import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth, isAdminConfigured } from "@/lib/server/firebaseAdmin";

/**
 * Who is calling an API route.
 *
 * Callable Cloud Functions verified the caller's ID token for us. Route
 * handlers do not, so this is the boundary that replaces it — and it is the
 * one piece of this migration that must not be got wrong: everything
 * downstream trusts the uid it returns.
 *
 * `verifyIdToken` checks the signature, the issuer, the audience and the
 * expiry against Google's public keys, so a forged or stale token cannot get
 * past it. Only the token is trusted; a uid in a request body is not.
 */

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/** Reads a bearer token, or nothing. */
function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") return null;
  return token.trim() || null;
}

/**
 * The verified caller.
 *
 * Throws rather than returning null so a handler cannot forget to check: an
 * unhandled HttpError becomes the right status, and there is no shape of the
 * result that looks signed-in but is not.
 */
export async function requireUser(request: Request): Promise<DecodedIdToken> {
  if (!isAdminConfigured()) {
    throw new HttpError(
      503,
      "This deployment has no server credentials, so it cannot verify who you are."
    );
  }
  const token = bearer(request);
  if (!token) throw new HttpError(401, "Sign in first.");

  try {
    // checkRevoked: a disabled or signed-out account stops working immediately
    // rather than at the end of the token's hour.
    return await adminAuth().verifyIdToken(token, true);
  } catch {
    throw new HttpError(401, "Your session has expired. Sign in again.");
  }
}

/** The verified caller, who must also hold the admin claim. */
export async function requireAdmin(request: Request): Promise<DecodedIdToken> {
  const user = await requireUser(request);
  if (user.role !== "admin") throw new HttpError(403, "Admins only.");
  return user;
}

/** Turns a thrown HttpError into its response; anything else is a 500. */
export function errorResponse(cause: unknown): Response {
  if (cause instanceof HttpError) {
    return Response.json({ error: cause.message }, { status: cause.status });
  }
  // Never echo an internal message to the caller.
  console.error("Unhandled API error:", cause);
  return Response.json({ error: "Something went wrong." }, { status: 500 });
}
