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
type AdminGrantSource = "allowlist" | "manual";

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
export function mayBecomeAdmin(
  email: string | undefined,
  verified: boolean,
): boolean {
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
  const profileRef = adminDb().doc(`users/${user.uid}`);
  const profile = await profileRef.get();
  const recordedSource = (user.customClaims?.roleSource ??
    profile.data()?.roleSource) as AdminGrantSource | undefined;
  // Admin claims created before roleSource existed were necessarily assigned
  // through an administrative path. Treating them as manual is the safe,
  // backwards-compatible migration: only grants we positively identify as
  // allowlist grants are governed by later allowlist changes.
  const source: AdminGrantSource | undefined =
    current === "admin" ? (recordedSource ?? "manual") : undefined;
  const eligible = mayBecomeAdmin(user.email, user.emailVerified);

  // The allowlist is authoritative only for grants it made. A manually granted
  // admin remains an admin, while an ineligible allowlist bootstrap returns to
  // the deliberately safe client role.
  const target: Role = eligible
    ? "admin"
    : current === "admin" && source === "allowlist"
      ? "client"
      : (current ?? "client");
  const targetSource: AdminGrantSource | null =
    target === "admin" ? (source === "manual" ? "manual" : "allowlist") : null;

  if (current === "admin" && source === "allowlist" && target !== "admin") {
    const otherAdmins = await adminDb()
      .collection("users")
      .where("role", "==", "admin")
      .limit(2)
      .get();
    if (!otherAdmins.docs.some((doc) => doc.id !== user.uid)) {
      throw new HttpError(
        409,
        "This is the last owner. Add and verify another allowlisted owner, or manually grant another admin before removing this address.",
      );
    }
  }

  const changed =
    current !== target ||
    user.customClaims?.rid !== RESTAURANT_ID ||
    (user.customClaims?.roleSource ?? null) !== targetSource;
  const now = new Date().toISOString();
  const roleMirror = {
    role: target,
    roleSource: targetSource,
    rid: RESTAURANT_ID,
    updatedAt: now,
    ...(changed ? { roleUpdatedAt: now } : {}),
  };

  // On revocation, hide authority from the UI before invalidating the claim.
  // On promotion, do the reverse so the UI never advertises authority that the
  // token does not yet possess. Firebase cannot transact Auth and Firestore,
  // so this ordering intentionally fails closed at the presentation boundary.
  if (changed && current === "admin" && target !== "admin") {
    await profileRef.set(roleMirror, { merge: true });
  }
  if (changed) {
    await adminAuth().setCustomUserClaims(user.uid, {
      role: target,
      rid: RESTAURANT_ID,
      ...(targetSource ? { roleSource: targetSource } : {}),
    });
  }

  await profileRef.set(
    {
      uid: user.uid,
      email: user.email ?? "",
      displayName: user.displayName ?? user.email?.split("@")[0] ?? "",
      ...(user.photoURL ? { photoURL: user.photoURL } : {}),
      ...roleMirror,
      signupMethod:
        user.providerData[0]?.providerId === "google.com"
          ? "google"
          : "password",
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
    { merge: true },
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
      { merge: true },
    );
}

/**
 * Grants or revokes a role. Admin only — the caller is checked by the route.
 */
export async function setRole(
  callerUid: string,
  uid: unknown,
  role: unknown,
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
    ...((role as Role) === "admin" ? { roleSource: "manual" } : {}),
  });

  const now = new Date().toISOString();
  const db = adminDb();
  const profileRef = db.doc(`users/${uid}`);
  const requestRef = db.doc(
    `restaurants/${RESTAURANT_ID}/staffRequests/${uid}`,
  );
  await db.runTransaction(async (transaction) => {
    // Read before writing so the profile mirror and any pending application
    // are resolved atomically. A role grant must never revive a rejected (or
    // otherwise already reviewed) request.
    const request =
      role === "client" ? null : await transaction.get(requestRef);
    transaction.set(
      profileRef,
      {
        role,
        roleSource: role === "admin" ? "manual" : null,
        rid: RESTAURANT_ID,
        roleUpdatedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );

    if (request?.data()?.status === "pending") {
      transaction.update(requestRef, {
        status: "approved",
        reviewedAt: now,
        reviewedByUid: callerUid,
      });
    }
  });

  return { uid, role: role as Role };
}
