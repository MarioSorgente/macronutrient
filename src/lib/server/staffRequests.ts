import "server-only";

import { randomUUID } from "node:crypto";
import { RESTAURANT_ID, adminAuth, adminDb } from "@/lib/server/firebaseAdmin";
import { HttpError } from "@/lib/server/auth";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Role, StaffAccessRequest } from "@/lib/storage/types";
import { writeRoleClaims } from "@/lib/server/roles";

const requestRef = (uid: string) =>
  adminDb().doc(`restaurants/${RESTAURANT_ID}/staffRequests/${uid}`);

export async function requestStaffAccess(caller: DecodedIdToken) {
  const account = await adminAuth().getUser(caller.uid);
  const currentRole = account.customClaims?.role;
  if (currentRole === "restaurant" || currentRole === "admin") {
    return { status: currentRole as Role };
  }
  if (currentRole !== undefined && currentRole !== "client") {
    throw new HttpError(409, "This account has an unsupported role.");
  }
  if (!account.email) throw new HttpError(400, "Your account needs an email address.");
  const now = new Date().toISOString();
  await requestRef(account.uid).set({
    id: account.uid,
    restaurantId: RESTAURANT_ID,
    uid: account.uid,
    email: account.email.trim().toLowerCase(),
    ...(account.displayName ? { displayName: account.displayName } : {}),
    emailVerified: account.emailVerified,
    status: "pending",
    createdAt: now,
    reviewedAt: null,
    reviewedByUid: null,
  });
  return { status: "pending" as const };
}

export async function getStaffRequest(uid: string): Promise<StaffAccessRequest | null> {
  const snap = await requestRef(uid).get();
  return snap.exists ? (snap.data() as StaffAccessRequest) : null;
}

export async function listStaffRequests(): Promise<StaffAccessRequest[]> {
  const snap = await adminDb()
    .collection(`restaurants/${RESTAURANT_ID}/staffRequests`)
    .where("status", "==", "pending")
    .get();
  const requests = await Promise.all(snap.docs.map(async (doc) => {
    const data = doc.data() as StaffAccessRequest;
    const account = await adminAuth().getUser(data.uid);
    return { ...data, emailVerified: account.emailVerified };
  }));
  return requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function approveStaffRequest(uid: unknown, adminUid: string) {
  if (typeof uid !== "string" || !uid) throw new HttpError(400, "Pass a request uid.");
  return approveStaffRequestWithHooks(uid, adminUid);
}

interface ApprovalHooks {
  /** Fault-injection/observability seam after Auth succeeds but before Firestore finalization. */
  afterClaimsApplied?: () => void | Promise<void>;
}

export async function approveStaffRequestWithHooks(
  uid: unknown,
  adminUid: string,
  hooks: ApprovalHooks = {},
) {
  if (typeof uid !== "string" || !uid) throw new HttpError(400, "Pass a request uid.");
  const ref = requestRef(uid);
  const account = await adminAuth().getUser(uid);
  if (!account.emailVerified) {
    throw new HttpError(409, "Email must be verified before staff access can be approved.");
  }
  const currentRole = account.customClaims?.role;
  if (currentRole !== undefined && currentRole !== "client" && currentRole !== "restaurant" && currentRole !== "admin") {
    throw new HttpError(409, "This account has an unsupported role.");
  }

  const proposedRole: Role = currentRole === "admin" ? "admin" : "restaurant";
  const proposedOperationId = randomUUID();
  const operation = await adminDb().runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const request = snap.data() as StaffAccessRequest | undefined;
    if (!request) throw new HttpError(409, "This staff request is no longer pending.");
    if (request.status === "approved" && request.reviewOperationId && request.intendedRole) {
      return { id: request.reviewOperationId, role: request.intendedRole, complete: true };
    }
    if (request.status === "approving" && request.reviewOperationId && request.intendedRole) {
      return { id: request.reviewOperationId, role: request.intendedRole, complete: false };
    }
    if (request.status !== "pending") {
      throw new HttpError(409, "This staff request is no longer pending.");
    }
    transaction.update(ref, {
      status: "approving",
      reviewOperationId: proposedOperationId,
      intendedRole: proposedRole,
      reviewedByUid: adminUid,
    });
    return { id: proposedOperationId, role: proposedRole, complete: false };
  });

  if (operation.complete) {
    return { uid, role: operation.role, status: "approved" as const };
  }

  // Auth and Firestore cannot commit together. The claimed operation makes
  // this write and every following step safe to repeat after a partial failure.
  const latestAccount = await adminAuth().getUser(uid);
  if (latestAccount.customClaims?.role !== operation.role) {
    await writeRoleClaims(latestAccount, operation.role);
  }
  await hooks.afterClaimsApplied?.();

  const now = new Date().toISOString();
  const db = adminDb();
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const request = snap.data() as StaffAccessRequest | undefined;
    if (request?.status === "approved" && request.reviewOperationId === operation.id) return;
    if (request?.status !== "approving" || request.reviewOperationId !== operation.id) {
      throw new HttpError(409, "This staff request is no longer owned by this approval.");
    }
    transaction.set(db.doc(`users/${uid}`), {
      role: operation.role,
      rid: RESTAURANT_ID,
      roleUpdatedAt: now,
      updatedAt: now,
    }, { merge: true });
    transaction.update(ref, {
      status: "approved",
      reviewedAt: now,
      emailVerified: true,
    });
  });
  return { uid, role: operation.role, status: "approved" as const };
}

export async function rejectStaffRequest(uid: unknown, adminUid: string) {
  if (typeof uid !== "string" || !uid) throw new HttpError(400, "Pass a request uid.");
  const ref = requestRef(uid);
  const now = new Date().toISOString();
  await adminDb().runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists || snap.data()?.status !== "pending") {
      throw new HttpError(409, "This staff request is no longer pending.");
    }
    transaction.update(ref, { status: "rejected", reviewedAt: now, reviewedByUid: adminUid });
  });
  return { uid, status: "rejected" as const };
}
