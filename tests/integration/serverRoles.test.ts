import { adminAuth, adminDb } from "@/lib/server/firebaseAdmin";
import { beforeEach, describe, expect, it } from "vitest";
import { setRole, syncAccount } from "@/lib/server/roles";
import { getStaffRequest, requestStaffAccess } from "@/lib/server/staffRequests";
import { HttpError } from "@/lib/server/auth";
import {
  RID,
  claimsOf,
  createUser,
  docAt,
  resetEmulators,
  setVerified,
  uniqueEmail,
} from "./serverHarness";

/**
 * Roles, as the /api/auth/sync and /api/admin/set-role routes run them.
 *
 * The behaviour that matters most here is that sync is reconciling rather than
 * one-shot. Its predecessor was an auth trigger that fired at sign-up and
 * never again, which left an owner whose account predated the deployment
 * permanently a customer with no route to admin — the bug that started all of
 * this.
 *
 * ADMIN_EMAILS is set for this project in vitest.config.ts and contains
 * owner@example.com.
 */

const OWNER = "owner@example.com";

const sync = async (uid: string) => syncAccount(await adminAuth().getUser(uid));

async function caller(uid: string) {
  const user = await adminAuth().getUser(uid);
  return { uid, email: user.email, role: user.customClaims?.role } as never;
}

beforeEach(resetEmulators);

describe("syncAccount", () => {
  it("makes an ordinary account a client", async () => {
    const uid = await createUser(uniqueEmail());
    await expect(sync(uid)).resolves.toMatchObject({ role: "client" });
    expect(await claimsOf(uid)).toMatchObject({ role: "client", rid: RID });
  });

  it("grants admin to a confirmed address on the allowlist", async () => {
    const uid = await createUser(OWNER, { verified: true });
    await expect(sync(uid)).resolves.toMatchObject({ role: "admin", changed: true });
    expect(await claimsOf(uid)).toMatchObject({ role: "admin", rid: RID });
  });

  it("matches the allowlist case-insensitively", async () => {
    const uid = await createUser(OWNER.toUpperCase(), { verified: true });
    await expect(sync(uid)).resolves.toMatchObject({ role: "admin" });
  });

  it("refuses an allowlisted address that is not confirmed", async () => {
    // Firebase does not confirm an address on password sign-up. Without this,
    // anyone who knew the owner's address could register it and take over.
    const uid = await createUser(OWNER, { verified: false });
    await expect(sync(uid)).resolves.toMatchObject({ role: "client" });
  });

  it("promotes on a LATER sync once the address is confirmed", async () => {
    // The whole point: being on the allowlist is enough, whenever the account
    // was made. The old trigger could never do this.
    const uid = await createUser(OWNER, { verified: false });
    await sync(uid);
    expect(await claimsOf(uid)).toMatchObject({ role: "client" });

    await setVerified(uid);
    await expect(sync(uid)).resolves.toMatchObject({ role: "admin", changed: true });
  });

  it("reports changed: false when there is nothing to do", async () => {
    // The client only forces a token refresh when something moved.
    const uid = await createUser(uniqueEmail());
    await sync(uid);
    await expect(sync(uid)).resolves.toMatchObject({ changed: false });
  });

  it("never downgrades a staff role granted by an admin", async () => {
    // Otherwise a restaurant account would drop to client on every sign-in.
    const uid = await createUser(uniqueEmail());
    await sync(uid);
    await setRole("some-admin", uid, "restaurant");
    await expect(sync(uid)).resolves.toMatchObject({ role: "restaurant" });
  });

  it("writes a profile the dashboard can render", async () => {
    const uid = await createUser(uniqueEmail());
    await sync(uid);
    const profile = await docAt(`users/${uid}`);
    expect(profile).toMatchObject({
      uid,
      role: "client",
      rid: RID,
      signupMethod: "password",
    });
    expect(profile?.roleUpdatedAt).toBeTruthy();
  });
});

describe("setRole", () => {
  it("grants a role and mirrors it", async () => {
    const uid = await createUser(uniqueEmail());
    await expect(setRole("admin-uid", uid, "restaurant")).resolves.toMatchObject({
      role: "restaurant",
    });
    expect(await claimsOf(uid)).toMatchObject({ role: "restaurant", rid: RID });
    expect(await docAt(`users/${uid}`)).toMatchObject({ role: "restaurant" });
  });

  it("bumps roleUpdatedAt, which is how a live browser learns to refresh", async () => {
    const uid = await createUser(uniqueEmail());
    await sync(uid);
    const before = (await docAt(`users/${uid}`))?.roleUpdatedAt;
    await setRole("admin-uid", uid, "restaurant");
    expect((await docAt(`users/${uid}`))?.roleUpdatedAt).not.toBe(before);
  });

  it.each([
    ["Staff", "restaurant"],
    ["Owner", "admin"],
  ] as const)(
    "resolves a Customer → %s promotion without weakening its claim",
    async (_label, role) => {
      const uid = await createUser(uniqueEmail("worker"));
      await sync(uid);
      await requestStaffAccess(await caller(uid));

      await setRole("promoting-admin", uid, role);

      expect(await claimsOf(uid)).toMatchObject({ role, rid: RID });
      expect(await docAt(`users/${uid}`)).toMatchObject({ role, rid: RID });
      expect(await getStaffRequest(uid)).toMatchObject({
        status: "approved",
        reviewedByUid: "promoting-admin",
      });
      expect((await getStaffRequest(uid))?.reviewedAt).toBeTruthy();
    }
  );

  it("does not change a rejected request during a later promotion", async () => {
    const uid = await createUser(uniqueEmail("worker"));
    await sync(uid);
    await requestStaffAccess(await caller(uid));
    const requestRef = adminDb().doc(`restaurants/${RID}/staffRequests/${uid}`);
    await requestRef.update({
      status: "rejected",
      reviewedAt: "earlier-review",
      reviewedByUid: "first-admin",
    });

    await setRole("promoting-admin", uid, "restaurant");

    expect(await getStaffRequest(uid)).toMatchObject({
      status: "rejected",
      reviewedAt: "earlier-review",
      reviewedByUid: "first-admin",
    });
  });

  it("does not reopen a pending request when assigning client", async () => {
    const uid = await createUser(uniqueEmail("worker"));
    await sync(uid);
    await requestStaffAccess(await caller(uid));

    await setRole("promoting-admin", uid, "client");

    expect(await getStaffRequest(uid)).toMatchObject({ status: "pending" });
  });

  it.each([
    ["an unknown role", "superuser"],
    ["an empty role", ""],
    ["a missing role", undefined],
  ])("rejects %s", async (_label, role) => {
    await expect(setRole("admin-uid", "someone", role)).rejects.toBeInstanceOf(HttpError);
  });

  it("rejects a missing uid", async () => {
    await expect(setRole("admin-uid", "", "client")).rejects.toBeInstanceOf(HttpError);
  });

  it("refuses to let the last admin demote themselves", async () => {
    // Losing the last admin would leave nobody able to grant roles back.
    const uid = await createUser(OWNER, { verified: true });
    await sync(uid);
    await expect(setRole(uid, uid, "client")).rejects.toThrow(/own admin role/i);
  });

  it("lets an admin re-affirm their own admin role", async () => {
    const uid = await createUser(OWNER, { verified: true });
    await sync(uid);
    await expect(setRole(uid, uid, "admin")).resolves.toMatchObject({ role: "admin" });
  });
});
