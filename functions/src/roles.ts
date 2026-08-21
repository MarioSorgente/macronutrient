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
    const role: Role = isBootstrapAdmin(user.email, ADMIN_EMAILS.value())
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

const ROLES: Role[] = ["client", "restaurant", "admin"];

/**
 * Grants or revokes a role. Admin only.
 *
 * Bumping `roleUpdatedAt` is not cosmetic: custom claims only reach a browser
 * when its ID token refreshes, which is up to an hour away. The client watches
 * that field and forces a refresh, so a change lands in seconds.
 */
export const setUserRole = onCall(
  { region: REGION, secrets: [ADMIN_EMAILS] },
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
