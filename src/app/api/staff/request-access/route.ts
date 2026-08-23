import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { getStaffRequest, requestStaffAccess } from "@/lib/server/staffRequests";

export async function POST(request: Request) {
  try { return NextResponse.json(await requestStaffAccess(await requireUser(request))); }
  catch (cause) { return errorResponse(cause); }
}

export async function GET(request: Request) {
  try {
    const caller = await requireUser(request);
    return NextResponse.json({ request: await getStaffRequest(caller.uid) });
  } catch (cause) { return errorResponse(cause); }
}
