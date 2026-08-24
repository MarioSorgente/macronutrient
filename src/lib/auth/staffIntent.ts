"use client";

import { callApi, getApi } from "@/lib/api";
import type { Role, StaffAccessRequest } from "@/lib/storage/types";

/** Where a staff-intent sign-in lands while approval is still outstanding. */
export const STAFF_PENDING_DESTINATION = "/account?staff-requested=1";
export const STAFF_DESTINATION = "/kitchen";

/**
 * Asks the server to reconcile this account, and reports the role it settled on.
 *
 * Deliberately not `AuthProvider.syncAccount`. This runs the instant a sign-in
 * resolves, and the provider has not necessarily seen the new user yet — its
 * `syncAccount` returns null for a signed-out provider, which made an owner
 * look like a customer and filed a staff request for the person who approves
 * them. `callApi` reads `auth.currentUser`, which is set the moment sign-in
 * resolves. The provider runs its own reconciliation for the same account a
 * moment later; both are idempotent.
 */
async function reconcile(): Promise<Role | null> {
  try {
    const { role, changed } = await callApi<{ role: Role; changed: boolean }>(
      "/api/auth/sync"
    );
    if (changed) {
      // Put the claim on the token before routing, so the guard at the far end
      // does not deny a role the server has just granted.
      const { getAuthClient } = await import("@/lib/storage/firebaseAuth");
      await getAuthClient().currentUser?.getIdToken(true);
    }
    return role;
  } catch {
    // An unreachable server must not strand somebody on the sign-in screen.
    // The request API below is the authority on what happens next anyway.
    return null;
  }
}

/**
 * Where somebody who said "I work at Negrita" should go, once they are signed in.
 *
 * The intent alone does not say what to do: the same click has to work for a
 * cook whose access was approved last month, a diner with an existing customer
 * account, and somebody who was rejected and wants to ask again. Sending all of
 * them to `/kitchen` and letting authorization fail is what the old signup did,
 * and it is why staff onboarding looked broken.
 *
 * The GET before the POST is what keeps a second click from filing a second
 * request. It is a courtesy rather than the guarantee — the server decides, and
 * `requestStaffAccess` already returns early for an account that is staff.
 *
 * `requested` is where they were actually headed, when that is known: an owner
 * bounced off `/admin` should come back to `/admin`, not be redirected to the
 * kitchen because the guard happened to tag the route as a staff one.
 */
export async function resolveStaffDestination(requested?: string): Promise<string> {
  // Reconciliation first: an owner on the allowlist becomes admin here, and a
  // cook approved while signed out gets their claim back onto the token. Asking
  // for a staff request before this would file one for somebody who is already
  // staff.
  const role = await reconcile();
  if (role === "restaurant" || role === "admin") {
    return requested || STAFF_DESTINATION;
  }

  try {
    const { request } = await getApi<{ request: StaffAccessRequest | null }>(
      "/api/staff/request-access"
    );
    // Pending needs no second request; approved is waiting on a token refresh,
    // not on the owner, and re-requesting would put a settled request back in
    // their queue.
    if (request?.status !== "pending" && request?.status !== "approved") {
      await callApi("/api/staff/request-access");
    }
  } catch {
    // Somebody who has just proved who they are must never be left looking at
    // the sign-in form. The account screen shows the real state and offers a
    // retry, which is a better answer than an error on a form they are done
    // with.
  }
  return STAFF_PENDING_DESTINATION;
}
