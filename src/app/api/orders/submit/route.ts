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
    return NextResponse.json(await submitOrder(caller.uid, body));
  } catch (cause) {
    return errorResponse(cause);
  }
}
