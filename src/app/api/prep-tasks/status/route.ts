import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { setPrepTaskStatus } from "@/lib/server/prepTasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await setPrepTaskStatus({
      uid: user.uid,
      role: user.role as string | undefined,
      rid: user.rid as string | undefined,
    }, body));
  } catch (cause) {
    return errorResponse(cause);
  }
}
