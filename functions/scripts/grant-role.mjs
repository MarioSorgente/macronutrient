/**
 * Grants a role to an existing account, from a machine with project access.
 *
 *   node functions/scripts/grant-role.mjs owner@example.com admin
 *   node functions/scripts/grant-role.mjs cook@example.com  restaurant
 *
 * Lives under functions/ because that is where firebase-admin is a real
 * dependency, and because this is a server-side administrative tool.
 *
 * WHY THIS EXISTS
 *
 * The role is a custom claim on the Firebase Auth token, and only two things
 * in the deployed app can set one: the `onUserCreate` trigger, which runs at
 * sign-up and never backfills, and `setUserRole`, which requires the caller to
 * already be an admin. An account that existed before the functions were
 * deployed — or before ADMIN_EMAILS contained its address — therefore has no
 * way to become admin from inside the app at all.
 *
 * `claimAdminAccess` fixes that for any project whose functions are deployed.
 * This script is the escape hatch for the case that one cannot cover: nothing
 * deployed yet, or an address that is not on the allowlist. It is also the
 * correct answer to "set the claim directly" — the Firebase console has no
 * custom-claims editor, so there is no way to do this by hand in a browser.
 *
 * CREDENTIALS
 *
 * Uses Application Default Credentials. Either:
 *   gcloud auth application-default login
 * or point GOOGLE_APPLICATION_CREDENTIALS at a service-account key.
 *
 * Set the project explicitly if it is not already in your environment:
 *   GOOGLE_CLOUD_PROJECT=your-project-id node functions/scripts/grant-role.mjs ...
 */

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const ROLES = ["client", "restaurant", "admin"];

/** Must match functions/src/config.ts. */
const RESTAURANT_ID = process.env.RESTAURANT_ID || "negrita";

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const [email, role] = process.argv.slice(2);

if (!email || !role) {
  die(
    "Usage: node functions/scripts/grant-role.mjs <email> <role>\n" +
      `  roles: ${ROLES.join(", ")}`
  );
}
if (!ROLES.includes(role)) {
  die(`"${role}" is not a role. Use one of: ${ROLES.join(", ")}`);
}

const projectId =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT;

// Against the emulator there are no credentials to find, and asking for them
// fails. This is also how the test suite exercises the script for real.
const emulated =
  Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST) ||
  Boolean(process.env.FIRESTORE_EMULATOR_HOST);

initializeApp({
  ...(emulated ? {} : { credential: applicationDefault() }),
  ...(projectId ? { projectId } : {}),
});

const auth = getAuth();
const db = getFirestore();

let user;
try {
  user = await auth.getUserByEmail(email);
} catch (cause) {
  if (cause?.code === "auth/user-not-found") {
    die(
      `No account exists for ${email}.\n` +
        "  They have to sign up first; this grants a role, it does not create one."
    );
  }
  die(
    `Could not reach Firebase Auth: ${cause?.message ?? cause}\n` +
      "  Check your credentials and that the project id is right:\n" +
      "    gcloud auth application-default login\n" +
      "    GOOGLE_CLOUD_PROJECT=<project-id> node functions/scripts/grant-role.mjs ..."
  );
}

const before = user.customClaims?.role ?? "none";

// The claim is the authority: firestore.rules reads request.auth.token.role
// and nothing else.
await auth.setCustomUserClaims(user.uid, { role, rid: RESTAURANT_ID });

const now = new Date().toISOString();

// The document copy is a display mirror — but roleUpdatedAt is not cosmetic.
// AuthProvider watches it and forces a token refresh, so an already-open
// browser picks this up in seconds instead of waiting for the hourly rotation.
await db.doc(`users/${user.uid}`).set(
  { uid: user.uid, role, rid: RESTAURANT_ID, roleUpdatedAt: now, updatedAt: now },
  { merge: true }
);

console.log(
  `\n  ${email}\n` +
    `    uid   ${user.uid}\n` +
    `    role  ${before} -> ${role}\n` +
    `    rid   ${RESTAURANT_ID}\n\n` +
    "  An open browser refreshes its token within a few seconds. Otherwise\n" +
    '  press "Refresh my access" on /account, or sign out and back in.\n'
);
