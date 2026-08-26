import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/server/auth";
import { updateRestaurantConfig } from "@/lib/server/restaurantConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const caller = await requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await updateRestaurantConfig(
      { uid: caller.uid, role: caller.role as string | undefined, rid: caller.rid as string | undefined },
      body
    ));
  } catch (cause) {
    return errorResponse(cause);
  }
}
