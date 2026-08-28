import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { submitOrder } from "@/lib/server/orders";

/**
 * Sends a week to the kitchen.
 *
 * Only the plan id, the week and the delivery choices come over the wire — the
 * server rebuilds everything else from the plan it reads itself, so there is
 * nothing here worth tampering with.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const caller = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    // Only the email claim from the Firebase-verified token may become the
    // order email. submitOrder rejects a missing/invalid claim; the writable
    // profile is intentionally never an email fallback.
    return NextResponse.json(await submitOrder(caller.uid, body, {
      email: typeof caller.email === "string" ? caller.email : undefined,
      name: typeof caller.name === "string" ? caller.name : undefined,
    }));
  } catch (cause) {
    return errorResponse(cause);
  }
}
