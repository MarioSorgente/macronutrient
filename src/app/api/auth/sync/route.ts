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
    // Read the body first. It is a stream on the request, and consuming it only
    // after several awaits on Auth and Firestore is asking for trouble.
    const body = (await request.json().catch(() => ({}))) as { signIn?: unknown };
    const caller = await requireUser(request);
    // Read the account fresh rather than trusting the token's copy of the
    // email or its verified flag, which may predate a confirmation.
    const user = await adminAuth().getUser(caller.uid);

    const result = await syncAccount(user);

    // Reconciliation is not a sign-in, and this endpoint is reached by four
    // things that are not one: the provider runs it on every page load (its
    // guard is a ref, so a refresh re-runs it), the account screen has a manual
    // "Refresh my access" button, and staff activation calls it too. Counting
    // all of them made `loginCount` a page-load counter that the owner
    // dashboard presented as sign-ins. Only a credential path asks for a stamp.
    if (body.signIn === true) {
      await stampSignIn(user.uid).catch(() => {
        // Usage metrics must never block a sign-in.
      });
    }

    return NextResponse.json(result);
  } catch (cause) {
    return errorResponse(cause);
  }
}
