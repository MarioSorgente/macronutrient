import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/server/auth";
import { setRole } from "@/lib/server/roles";

/** Grants or revokes a role. Admin only. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const caller = await requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await setRole(caller.uid, body.uid, body.role));
  } catch (cause) {
    return errorResponse(cause);
  }
}
