import { beforeEach, describe, expect, it } from "vitest";
import { adminAuth } from "@/lib/server/firebaseAdmin";
import { setRole, syncAccount } from "@/lib/server/roles";
import { approveStaffRequest, getStaffRequest, rejectStaffRequest, requestStaffAccess } from "@/lib/server/staffRequests";
import { claimsOf, createUser, docAt, resetEmulators, setVerified, uniqueEmail } from "./serverHarness";

beforeEach(resetEmulators);

async function caller(uid: string) {
  const user = await adminAuth().getUser(uid);
  return { uid, email: user.email, role: user.customClaims?.role } as never;
}

describe("staff access requests", () => {
  it("keeps an applicant a customer and reuses one pending request", async () => {
    const uid = await createUser(uniqueEmail("worker"));
    await syncAccount(await adminAuth().getUser(uid));
    await requestStaffAccess(await caller(uid));
    await requestStaffAccess(await caller(uid));
    expect(await claimsOf(uid)).toMatchObject({ role: "client" });
    expect(await getStaffRequest(uid)).toMatchObject({ uid, status: "pending" });
  });

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

  it("rejects without changing the customer and permits a new request", async () => {
    const uid = await createUser(uniqueEmail("worker"));
    await syncAccount(await adminAuth().getUser(uid));
    await requestStaffAccess(await caller(uid));
    await rejectStaffRequest(uid, "owner");
    expect(await claimsOf(uid)).toMatchObject({ role: "client" });
    await requestStaffAccess(await caller(uid));
    expect(await getStaffRequest(uid)).toMatchObject({ status: "pending" });
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
