import { NextResponse } from "next/server";
import { isAdminConfigured, RESTAURANT_ID } from "@/lib/server/firebaseAdmin";

/**
 * Is the server half of this deployment actually running?
 *
 * The point of this route is the import above. Every other API route needs a
 * signed-in caller before it can tell you anything, so when the server module
 * graph fails to load at all — as it did when `jwks-rsa` reached for an
 * ESM-only `jose` and Vercel's loader refused — the only symptom anyone saw was
 * "signing in does not make me an admin". This answers that in one request,
 * with no account and no console.
 *
 * A 500 means the server is broken and no amount of configuration will grant a
 * role until it is fixed. A 200 with `adminConfigured: false` means the server
 * runs but has no credentials, which is a missing environment variable.
 *
 * Deliberately unauthenticated: it has to work when authentication is the thing
 * that is broken. It reports whether credentials are present, never what they
 * are, and the restaurant id is already public in the browser bundle.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    adminConfigured: isAdminConfigured(),
    restaurantId: RESTAURANT_ID,
  });
}
