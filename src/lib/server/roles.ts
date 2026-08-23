import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { UserRecord } from "firebase-admin/auth";
import {
  RESTAURANT_ID,
  adminAuth,
  adminDb,
  adminEmails,
} from "@/lib/server/firebaseAdmin";
import { HttpError } from "@/lib/server/auth";
import type { Role } from "@/lib/storage/types";

/**
 * Roles.
 *
 * The authoritative role is a custom claim on the Firebase Auth token, not a
 * document — a document is something a user could try to write, a claim is
 * not. The security rules read `request.auth.token.role` and nothing else; the
 * copy on `users/{uid}` exists only so the UI can render a label.
 *
 * This used to be an auth trigger that ran once at sign-up and never again,
 * which is what left an owner whose account predated the deployment stuck as a
 * customer with no way out. Sync runs on every sign-in instead, so the role is
 * continuously reconciled and that whole class of deadlock is gone.
 */

export const ROLES: Role[] = ["client", "restaurant", "admin"];

function onAllowlist(email: string | undefined): boolean {
  if (!email) return false;
  return adminEmails()
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

/**
 * Whether an account may hold owner access.
 *
 * The verified check is load-bearing. Firebase does not confirm an address on
 * password sign-up, so without it anyone who knew an allowlisted address could
 * register it first and take the restaurant. Google sign-in is already
 * verified. Only the admin path is gated — an ordinary sign-up is a `client`
 * either way.
 */
export function mayBecomeAdmin(email: string | undefined, verified: boolean): boolean {
  return verified && onAllowlist(email);
}

export interface SyncResult {
  role: Role;
  /** True when this call changed the stored claim, so the client must refresh. */
  changed: boolean;
}

/**
 * Brings an account's profile and role claim up to date.
 *
 * Called on every sign-in. Idempotent, and safe for anyone: a customer is
 * confirmed as a `client` and nothing else happens.
 */
export async function syncAccount(user: UserRecord): Promise<SyncResult> {
  const current = (user.customClaims?.role as Role | undefined) ?? null;

  // An existing staff role is never downgraded here. Only an admin, through
  // setRole, decides that — otherwise a restaurant account would be demoted
  // to client every time its owner signed in.
  const target: Role = mayBecomeAdmin(user.email, user.emailVerified)
    ? "admin"
    : current ?? "client";

  const changed = current !== target || user.customClaims?.rid !== RESTAURANT_ID;
  if (changed) {
    await adminAuth().setCustomUserClaims(user.uid, {
      role: target,
      rid: RESTAURANT_ID,
    });
  }

  const now = new Date().toISOString();
  await adminDb()
    .doc(`users/${user.uid}`)
    .set(
      {
        uid: user.uid,
        email: user.email ?? "",
        displayName:
          user.displayName ?? user.email?.split("@")[0] ?? "",
        ...(user.photoURL ? { photoURL: user.photoURL } : {}),
        role: target,
        rid: RESTAURANT_ID,
        signupMethod:
          user.providerData[0]?.providerId === "google.com" ? "google" : "password",
        // Only stamped the first time; a merge leaves an existing value alone
        // only if we do not send it, so it is set on create via the metadata.
        createdAt: user.metadata.creationTime
          ? new Date(user.metadata.creationTime).toISOString()
          : now,
        updatedAt: now,
        // Watched by the client to force a token refresh, so a change lands in
        // seconds rather than at the end of the token's hour.
        ...(changed ? { roleUpdatedAt: now } : {}),
      },
      { merge: true }
    );

  return { role: target, changed };
}

/** Records a sign-in. The only source of the dashboard's usage figures. */
export async function stampSignIn(uid: string): Promise<void> {
  const now = new Date().toISOString();
  await adminDb()
    .doc(`users/${uid}`)
    .set(
      { lastLoginAt: now, loginCount: FieldValue.increment(1), updatedAt: now },
      { merge: true }
    );
}

/**
 * Grants or revokes a role. Admin only — the caller is checked by the route.
 */
export async function setRole(
  callerUid: string,
  uid: unknown,
  role: unknown
): Promise<{ uid: string; role: Role }> {
  if (typeof uid !== "string" || !uid || !ROLES.includes(role as Role)) {
    throw new HttpError(400, "Pass a uid and a valid role.");
  }
  if (uid === callerUid && role !== "admin") {
    // Losing the last admin would leave nobody able to grant roles back.
    throw new HttpError(409, "You cannot remove your own admin role.");
  }

  await adminAuth().setCustomUserClaims(uid, {
    role: role as Role,
    rid: RESTAURANT_ID,
  });

  const now = new Date().toISOString();
  await adminDb()
    .doc(`users/${uid}`)
    .set(
      { role, rid: RESTAURANT_ID, roleUpdatedAt: now, updatedAt: now },
      { merge: true }
    );

  return { uid, role: role as Role };
}
