import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { setOrderStatus } from "@/lib/server/orders";

/**
 * Moves an order through its lifecycle, clearing the kitchen's board when it
 * dies. Staff may make any transition; a customer may only cancel their own
 * week, and only before the kitchen has accepted it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const caller = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(
      await setOrderStatus(
        { uid: caller.uid, role: caller.role as string | undefined },
        body.orderId,
        body.status,
        body.note
      )
    );
  } catch (cause) {
    return errorResponse(cause);
  }
}
