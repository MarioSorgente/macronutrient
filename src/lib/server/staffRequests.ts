import "server-only";

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
  const ref = requestRef(uid);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.status !== "pending") {
    throw new HttpError(409, "This staff request is no longer pending.");
  }
  const account = await adminAuth().getUser(uid);
  if (!account.emailVerified) {
    throw new HttpError(409, "Email must be verified before staff access can be approved.");
  }
  const currentRole = account.customClaims?.role;
  if (currentRole !== undefined && currentRole !== "client" && currentRole !== "restaurant" && currentRole !== "admin") {
    throw new HttpError(409, "This account has an unsupported role.");
  }

  const role = currentRole === "admin" ? "admin" : "restaurant";
  if (currentRole === undefined || currentRole === "client") {
    await writeRoleClaims(account, role);
  }
  const now = new Date().toISOString();
  const batch = adminDb().batch();
  if (currentRole === undefined || currentRole === "client") {
    batch.set(adminDb().doc(`users/${uid}`), {
      role, rid: RESTAURANT_ID, roleUpdatedAt: now, updatedAt: now,
    }, { merge: true });
  }
  batch.update(ref, { status: "approved", reviewedAt: now, reviewedByUid: adminUid, emailVerified: true });
  await batch.commit();
  return { uid, role, status: "approved" as const };
}

export async function rejectStaffRequest(uid: unknown, adminUid: string) {
  if (typeof uid !== "string" || !uid) throw new HttpError(400, "Pass a request uid.");
  const ref = requestRef(uid);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.status !== "pending") {
    throw new HttpError(409, "This staff request is no longer pending.");
  }
  const now = new Date().toISOString();
  await ref.update({ status: "rejected", reviewedAt: now, reviewedByUid: adminUid });
  return { uid, status: "rejected" as const };
}
