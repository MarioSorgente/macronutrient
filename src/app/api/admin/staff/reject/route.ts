import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/server/auth";
import { rejectStaffRequest } from "@/lib/server/staffRequests";
export async function POST(request: Request) {
  try { const admin = await requireAdmin(request); const body = await request.json(); return NextResponse.json(await rejectStaffRequest(body.uid, admin.uid)); }
  catch (cause) { return errorResponse(cause); }
}
