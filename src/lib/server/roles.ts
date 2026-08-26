import "server-only";

import { randomUUID } from "node:crypto";
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

interface RoleTransition {
  operationId: string;
  targetRole: Role;
  actorUid: string;
  status: "pending" | "failed" | "completed";
  createdAt: string;
  completedAt?: string;
  failedAt?: string;
}

const RESERVED_CLAIM_KEYS = new Set([
  "acr", "amr", "at_hash", "aud", "auth_time", "azp", "cnf", "c_hash",
  "exp", "iat", "iss", "jti", "nbf", "nonce", "sub", "firebase",
]);
const UNSAFE_CLAIM_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_CUSTOM_CLAIMS_BYTES = 1_000;

/**
 * Updates this application's role claims without erasing claims owned by other
 * systems. The UserRecord is deliberately required so every caller merges the
 * last Auth value rather than an ID-token snapshot.
 */
export async function writeRoleClaims(
  user: UserRecord,
  role: Role,
  source?: AdminGrantSource,
): Promise<void> {
  const claims: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(user.customClaims ?? {})) {
    if (RESERVED_CLAIM_KEYS.has(key) || UNSAFE_CLAIM_KEYS.has(key)) {
      throw new HttpError(400, `Custom claim key "${key}" is not allowed.`);
    }
    // roleSource belongs to this role domain and is obsolete for non-admins.
    if (key !== "roleSource") claims[key] = value;
  }
  claims.role = role;
  claims.rid = RESTAURANT_ID;
  if (source) claims.roleSource = source;

  const serialized = JSON.stringify(claims);
  if (Buffer.byteLength(serialized, "utf8") > MAX_CUSTOM_CLAIMS_BYTES) {
    throw new HttpError(400, "Custom claims exceed Firebase's 1000-byte limit.");
  }
  await adminAuth().setCustomUserClaims(user.uid, claims);
}

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

function transitionFrom(data: FirebaseFirestore.DocumentData | undefined): RoleTransition | null {
  const transition = data?.roleTransition;
  if (
    !transition ||
    typeof transition.operationId !== "string" ||
    typeof transition.actorUid !== "string" ||
    !ROLES.includes(transition.targetRole) ||
    !["pending", "failed", "completed"].includes(transition.status)
  ) {
    return null;
  }
  return transition as RoleTransition;
}

async function finalizeRoleTransition(uid: string, operation: RoleTransition): Promise<void> {
  const now = new Date().toISOString();
  const db = adminDb();
  const profileRef = db.doc(`users/${uid}`);
  const requestRef = db.doc(`restaurants/${RESTAURANT_ID}/staffRequests/${uid}`);
  await db.runTransaction(async (transaction) => {
    const [profile, request] = await Promise.all([
      transaction.get(profileRef),
      operation.targetRole === "client" ? Promise.resolve(null) : transaction.get(requestRef),
    ]);
    const current = transitionFrom(profile.data());
    if (current?.operationId === operation.operationId && current.status === "completed") return;
    if (current?.operationId !== operation.operationId || current.status !== "pending") {
      throw new HttpError(409, "This role transition is no longer active.");
    }
    transaction.set(profileRef, {
      role: operation.targetRole,
      roleSource: operation.targetRole === "admin" ? "manual" : null,
      rid: RESTAURANT_ID,
      roleUpdatedAt: now,
      updatedAt: now,
      roleTransition: { ...operation, status: "completed", completedAt: now },
    }, { merge: true });
    if (request?.data()?.status === "pending") {
      transaction.update(requestRef, {
        status: "approved",
        reviewedAt: now,
        reviewedByUid: operation.actorUid,
      });
    }
  });
}

async function applyRoleTransition(
  uid: string,
  operation: RoleTransition,
  account: UserRecord,
  hooks: SetRoleHooks = {},
): Promise<void> {
  const source = operation.targetRole === "admin" ? "manual" : undefined;
  if (
    account.customClaims?.role !== operation.targetRole ||
    account.customClaims?.rid !== RESTAURANT_ID ||
    (account.customClaims?.roleSource ?? null) !== (source ?? null)
  ) {
    try {
      await hooks.beforeClaimsApplied?.();
      await writeRoleClaims(account, operation.targetRole, source);
    } catch (cause) {
      const failedAt = new Date().toISOString();
      const profileRef = adminDb().doc(`users/${uid}`);
      await adminDb().runTransaction(async (transaction) => {
        const profile = await transaction.get(profileRef);
        const current = transitionFrom(profile.data());
        if (current?.operationId === operation.operationId && current.status === "pending") {
          transaction.set(profileRef, {
            roleTransition: { ...operation, status: "failed", failedAt },
          }, { merge: true });
        }
      });
      throw cause;
    }
  }
  await hooks.afterClaimsApplied?.();
  await finalizeRoleTransition(uid, operation);
}

async function reconcilePendingRoleTransition(user: UserRecord): Promise<UserRecord> {
  const profile = await adminDb().doc(`users/${user.uid}`).get();
  const operation = transitionFrom(profile.data());
  if (operation?.status !== "pending") return user;
  await applyRoleTransition(user.uid, operation, user);
  return adminAuth().getUser(user.uid);
}

/**
 * Brings an account's profile and role claim up to date.
 *
 * Called on every sign-in. Idempotent, and safe for anyone: a customer is
 * confirmed as a `client` and nothing else happens.
 */
export async function syncAccount(user: UserRecord): Promise<SyncResult> {
  // Finish a manual operation before considering the allowlist. In particular,
  // an admin grant which reached Auth but not its profile mirror must retain its
  // manual source rather than being mistaken for an allowlist-managed grant.
  user = await reconcilePendingRoleTransition(user);
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
    await writeRoleClaims(user, target, targetSource ?? undefined);
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
  return setRoleWithHooks(callerUid, uid, role);
}

export interface SetRoleHooks {
  /** Test/observability seams around the non-transactional Auth boundary. */
  beforeClaimsApplied?: () => void | Promise<void>;
  afterClaimsApplied?: () => void | Promise<void>;
}

export async function setRoleWithHooks(
  callerUid: string,
  uid: unknown,
  role: unknown,
  hooks: SetRoleHooks = {},
): Promise<{ uid: string; role: Role }> {
  if (typeof uid !== "string" || !uid || !ROLES.includes(role as Role)) {
    throw new HttpError(400, "Pass a uid and a valid role.");
  }
  if (uid === callerUid && role !== "admin") {
    // Losing the last admin would leave nobody able to grant roles back.
    throw new HttpError(409, "You cannot remove your own admin role.");
  }

  let account = await adminAuth().getUser(uid);
  account = await reconcilePendingRoleTransition(account);
  const now = new Date().toISOString();
  const db = adminDb();
  const profileRef = db.doc(`users/${uid}`);
  const operation: RoleTransition = {
    operationId: randomUUID(),
    targetRole: role as Role,
    actorUid: callerUid,
    status: "pending",
    createdAt: now,
  };
  // This durable intent is written before Auth. It is the recovery record for
  // the unavoidable gap between Firebase Auth and Firestore.
  await profileRef.set({ roleTransition: operation, updatedAt: now }, { merge: true });
  await applyRoleTransition(uid, operation, account, hooks);

  return { uid, role: role as Role };
}
