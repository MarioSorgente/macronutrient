import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/server/firebaseAdmin";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { stampSignIn, syncAccount } from "@/lib/server/roles";

/**
 * Called by the app on every sign-in.
 *
 * Replaces the auth trigger that used to run once at sign-up and never again —
 * the behaviour that left an owner whose account predated the deployment with
 * no route to admin at all. Reconciling on every sign-in means being on the
 * allowlist is enough on its own, whenever the account was created.
 */
export const runtime = "nodejs";
// Nothing here is cacheable: it writes.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const caller = await requireUser(request);
    // Read the account fresh rather than trusting the token's copy of the
    // email or its verified flag, which may predate a confirmation.
    const user = await adminAuth().getUser(caller.uid);

    const result = await syncAccount(user);
    await stampSignIn(user.uid).catch(() => {
      // Usage metrics must never block a sign-in.
    });

    return NextResponse.json(result);
  } catch (cause) {
    return errorResponse(cause);
  }
}
