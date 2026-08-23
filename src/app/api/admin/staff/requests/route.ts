import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/server/auth";
import { listStaffRequests } from "@/lib/server/staffRequests";
export async function GET(request: Request) {
  try { await requireAdmin(request); return NextResponse.json({ requests: await listStaffRequests() }); }
  catch (cause) { return errorResponse(cause); }
}
