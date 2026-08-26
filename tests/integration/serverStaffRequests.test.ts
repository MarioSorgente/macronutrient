import { beforeEach, describe, expect, it } from "vitest";
import { adminAuth } from "@/lib/server/firebaseAdmin";
import { setRole, syncAccount } from "@/lib/server/roles";
import {
  approveStaffRequest,
  approveStaffRequestWithHooks,
  getStaffRequest,
  rejectStaffRequest,
  requestStaffAccess,
} from "@/lib/server/staffRequests";
import { claimsOf, createUser, docAt, resetEmulators, setVerified, uniqueEmail } from "./serverHarness";

beforeEach(resetEmulators);

async function caller(uid: string) {
  const user = await adminAuth().getUser(uid);
  return { uid, email: user.email, role: user.customClaims?.role } as never;
}

describe("staff access requests", () => {
  it("creates a pending request for a customer with no request", async () => {
    const uid = await createUser(uniqueEmail("worker"));
    await syncAccount(await adminAuth().getUser(uid));
    expect(await getStaffRequest(uid)).toBeNull();

    await expect(requestStaffAccess(await caller(uid))).resolves.toEqual({ status: "pending" });

    expect(await claimsOf(uid)).toMatchObject({ role: "client" });
    expect(await getStaffRequest(uid)).toMatchObject({ uid, status: "pending" });
  });

  it.each(["restaurant", "admin"] as const)(
    "uses the current Auth role for a stale %s caller without creating a request",
    async (role) => {
      const uid = await createUser(uniqueEmail(role));
      await syncAccount(await adminAuth().getUser(uid));
      const staleCaller = await caller(uid);
      await setRole("owner", uid, role);

      await expect(requestStaffAccess(staleCaller)).resolves.toEqual({ status: role });

      expect(await getStaffRequest(uid)).toBeNull();
    }
  );

  it("approves only verified accounts and updates authorization and UI data", async () => {
    const uid = await createUser(uniqueEmail("worker"));
    await syncAccount(await adminAuth().getUser(uid));
    await requestStaffAccess(await caller(uid));
    await expect(approveStaffRequest(uid, "owner")).rejects.toThrow(/verified/i);
    await setVerified(uid);
    await expect(approveStaffRequest(uid, "owner")).resolves.toMatchObject({ role: "restaurant", status: "approved" });
    expect(await claimsOf(uid)).toMatchObject({ role: "restaurant" });
    expect(await docAt(`users/${uid}`)).toMatchObject({ role: "restaurant" });
    expect((await docAt(`users/${uid}`))?.roleUpdatedAt).toBeTruthy();
    expect(await getStaffRequest(uid)).toMatchObject({ status: "approved", reviewedByUid: "owner" });
  });

  it("preserves unrelated claims during staff approval", async () => {
    const uid = await createUser(uniqueEmail("worker"), { verified: true });
    await adminAuth().setCustomUserClaims(uid, {
      role: "client",
      rid: "negrita",
      featureTier: "gold",
    });
    await requestStaffAccess(await caller(uid));

    await approveStaffRequest(uid, "owner");

    expect(await claimsOf(uid)).toMatchObject({
      featureTier: "gold",
      role: "restaurant",
    });
  });

  it("atomically chooses approval or rejection when reviews start together", async () => {
    const uid = await createUser(uniqueEmail("worker"), { verified: true });
    await syncAccount(await adminAuth().getUser(uid));
    await requestStaffAccess(await caller(uid));

    const results = await Promise.allSettled([
      approveStaffRequest(uid, "approver"),
      rejectStaffRequest(uid, "rejecter"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const request = await getStaffRequest(uid);
    expect(["approved", "rejected"]).toContain(request?.status);
    if (request?.status === "approved") {
      expect(await claimsOf(uid)).toMatchObject({ role: "restaurant" });
      expect(await docAt(`users/${uid}`)).toMatchObject({ role: "restaurant" });
      expect(request).toMatchObject({ reviewedByUid: "approver", intendedRole: "restaurant" });
    } else {
      expect(await claimsOf(uid)).toMatchObject({ role: "client" });
      expect(request).toMatchObject({ reviewedByUid: "rejecter" });
    }
  });

  it("resumes an approval that fails after assigning Auth claims", async () => {
    const uid = await createUser(uniqueEmail("worker"), { verified: true });
    await syncAccount(await adminAuth().getUser(uid));
    await requestStaffAccess(await caller(uid));

    await expect(approveStaffRequestWithHooks(uid, "owner", {
      afterClaimsApplied: () => { throw new Error("injected finalization failure"); },
    })).rejects.toThrow(/injected finalization failure/);

    const claimed = await getStaffRequest(uid);
    expect(claimed).toMatchObject({
      status: "approving",
      intendedRole: "restaurant",
      reviewedByUid: "owner",
    });
    expect(claimed?.reviewOperationId).toBeTruthy();
    expect(await claimsOf(uid)).toMatchObject({ role: "restaurant" });
    expect(await docAt(`users/${uid}`)).toMatchObject({ role: "client" });
    await expect(rejectStaffRequest(uid, "rejecter")).rejects.toThrow(/no longer pending/i);

    await expect(approveStaffRequest(uid, "retrying-owner")).resolves.toMatchObject({
      role: "restaurant",
      status: "approved",
    });
    expect(await getStaffRequest(uid)).toMatchObject({
      status: "approved",
      reviewOperationId: claimed?.reviewOperationId,
      reviewedByUid: "owner",
    });
    expect(await docAt(`users/${uid}`)).toMatchObject({ role: "restaurant" });
  });

  it("does not let a stale staff approval overwrite an assigned admin role", async () => {
    const uid = await createUser(uniqueEmail("worker"), { verified: true });
    await syncAccount(await adminAuth().getUser(uid));
    await requestStaffAccess(await caller(uid));
    await setRole("owner", uid, "admin");

    await expect(approveStaffRequest(uid, "owner")).rejects.toThrow(/no longer pending/i);

    expect(await claimsOf(uid)).toMatchObject({ role: "admin" });
    expect(await docAt(`users/${uid}`)).toMatchObject({ role: "admin" });
    expect(await getStaffRequest(uid)).toMatchObject({
      status: "approved",
      reviewedByUid: "owner",
    });
  });

  it("replaces a rejected customer request with a new pending request", async () => {
    const uid = await createUser(uniqueEmail("worker"));
    await syncAccount(await adminAuth().getUser(uid));
    await requestStaffAccess(await caller(uid));
    await rejectStaffRequest(uid, "owner");
    expect(await claimsOf(uid)).toMatchObject({ role: "client" });
    const rejected = await getStaffRequest(uid);
    expect(rejected).toMatchObject({ status: "rejected", reviewedByUid: "owner" });

    await expect(requestStaffAccess(await caller(uid))).resolves.toEqual({ status: "pending" });

    expect(await getStaffRequest(uid)).toMatchObject({
      status: "pending",
      reviewedAt: null,
      reviewedByUid: null,
    });
  });

  it("never lets an old approval re-promote manually demoted staff", async () => {
    const uid = await createUser(uniqueEmail("worker"), { verified: true });
    await syncAccount(await adminAuth().getUser(uid));
    await requestStaffAccess(await caller(uid));
    await approveStaffRequest(uid, "owner");
    await setRole("owner", uid, "client");
    await syncAccount(await adminAuth().getUser(uid));
    expect(await claimsOf(uid)).toMatchObject({ role: "client" });
    expect(await getStaffRequest(uid)).toMatchObject({ status: "approved" });
  });
});
