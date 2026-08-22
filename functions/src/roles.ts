import * as functionsV1 from "firebase-functions/v1";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { REGION, RESTAURANT_ID } from "./config";

/**
 * Roles.
 *
 * The authoritative role is a custom claim on the Firebase Auth token, not a
 * document — a document is something a user could try to write, a claim is not.
 * Security rules read `request.auth.token.role` and nothing else. The copy
 * written to `users/{uid}.role` exists only so the UI can render a label.
 */

export type Role = "client" | "restaurant" | "admin";

/**
 * Bootstrap allowlist for the first admin, since there is no admin yet to
 * promote one. Held in Secret Manager rather than in code or in the client
 * bundle. Comma-separated.
 */
const ADMIN_EMAILS = defineSecret("ADMIN_EMAILS");

function isBootstrapAdmin(email: string | undefined, allowlist: string): boolean {
  if (!email) return false;
  return allowlist
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

/**
 * Whether an address may be granted owner access.
 *
 * The verified check is load-bearing, not belt-and-braces. Firebase does not
 * verify an address on password sign-up, so without it anyone who knows an
 * allowlisted address could register it first and take the restaurant. Google
 * sign-in is verified already; anyone this blocks is granted by
 * functions/scripts/grant-role.mjs instead.
 *
 * Only the admin path is gated. Ordinary sign-up still becomes `client`
 * whether or not the address has been confirmed.
 */
function mayBecomeAdmin(
  email: string | undefined,
  emailVerified: boolean,
  allowlist: string
): boolean {
  return emailVerified && isBootstrapAdmin(email, allowlist);
}

/**
 * Creates the profile document and stamps the initial role.
 *
 * This is a v1 auth trigger on purpose: the v2 equivalent is a *blocking*
 * function, which requires upgrading the project to Identity Platform. Nothing
 * here needs to block sign-up, so the v1 trigger is the cheaper path.
 */
export const onUserCreate = functionsV1
  .runWith({ secrets: [ADMIN_EMAILS] })
  .auth.user()
  .onCreate(async (user) => {
    const role: Role = mayBecomeAdmin(
      user.email,
      user.emailVerified,
      ADMIN_EMAILS.value()
    )
      ? "admin"
      : "client";

    await getAuth().setCustomUserClaims(user.uid, {
      role,
      rid: RESTAURANT_ID,
    });

    const now = new Date().toISOString();
    // Merged, because the client may already have written its sign-in stamp
    // before this trigger ran. Whichever lands second must not erase the other.
    await getFirestore()
      .doc(`users/${user.uid}`)
      .set(
        {
          uid: user.uid,
          email: user.email ?? "",
          displayName: user.displayName ?? user.email?.split("@")[0] ?? "",
          ...(user.photoURL ? { photoURL: user.photoURL } : {}),
          role,
          rid: RESTAURANT_ID,
          signupMethod: user.providerData[0]?.providerId === "google.com"
            ? "google"
            : "password",
          createdAt: now,
          updatedAt: now,
          roleUpdatedAt: now,
        },
        { merge: true }
      );
  });

/**
 * Lets the owner take admin access on an account that never received it.
 *
 * Without this the bootstrap is a one-shot with no recovery: `onUserCreate`
 * stamps the first admin at sign-up and never backfills, and `setUserRole`
 * below refuses anyone who is not already an admin. An account created before
 * the functions were deployed — or before ADMIN_EMAILS held its address — is
 * therefore stuck as a customer forever, and the only advice the app could
 * give was to delete it and sign up again, discarding that person's plans and
 * order history.
 *
 * Safe to expose: the decision is made entirely from the Secret Manager
 * allowlist and the caller's own verified token. Nothing in the request
 * influences it, so there is no argument worth tampering with. Idempotent, so
 * the app can call it opportunistically.
 */
export const claimAdminAccess = onCall(
  { region: REGION, secrets: [ADMIN_EMAILS] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in first.");
    }

    const { uid, token } = request.auth;
    if (!mayBecomeAdmin(token.email, token.email_verified === true, ADMIN_EMAILS.value())) {
      // Deliberately says nothing about which of the two conditions failed:
      // a precise message would turn this into a way to test who is on the
      // allowlist.
      throw new HttpsError(
        "permission-denied",
        "This account is not on the owner allowlist."
      );
    }

    await getAuth().setCustomUserClaims(uid, {
      role: "admin",
      rid: RESTAURANT_ID,
    });

    const now = new Date().toISOString();
    await getFirestore().doc(`users/${uid}`).set(
      {
        uid,
        role: "admin",
        rid: RESTAURANT_ID,
        roleUpdatedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    return { role: "admin" as Role };
  }
);

const ROLES: Role[] = ["client", "restaurant", "admin"];

/**
 * Grants or revokes a role. Admin only.
 *
 * Bumping `roleUpdatedAt` is not cosmetic: custom claims only reach a browser
 * when its ID token refreshes, which is up to an hour away. The client watches
 * that field and forces a refresh, so a change lands in seconds.
 */
export const setUserRole = onCall(
  { region: REGION },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in first.");
    }
    if (request.auth.token.role !== "admin") {
      throw new HttpsError("permission-denied", "Admins only.");
    }

    const { uid, role } = request.data as { uid?: string; role?: Role };
    if (!uid || !role || !ROLES.includes(role)) {
      throw new HttpsError("invalid-argument", "Pass a uid and a valid role.");
    }
    if (uid === request.auth.uid && role !== "admin") {
      // Losing the last admin would leave nobody able to grant roles back.
      throw new HttpsError(
        "failed-precondition",
        "You cannot remove your own admin role."
      );
    }

    await getAuth().setCustomUserClaims(uid, { role, rid: RESTAURANT_ID });

    const now = new Date().toISOString();
    await getFirestore().doc(`users/${uid}`).set(
      { role, rid: RESTAURANT_ID, roleUpdatedAt: now, updatedAt: now },
      { merge: true }
    );

    return { uid, role };
  }
);
