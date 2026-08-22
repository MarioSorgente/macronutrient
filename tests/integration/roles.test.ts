import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  RESTAURANT_ID,
  adminGet,
  clearAuth,
  clearFirestore,
  createHarness,
  waitFor,
  type Harness,
} from "./appHarness";

/**
 * Roles.
 *
 * The authoritative role is a custom claim on the ID token, not a document —
 * a document is something a user could try to write. These tests exercise the
 * two functions that own that claim: the sign-up trigger that stamps it, and
 * the admin-only callable that changes it.
 *
 * ADMIN_EMAILS comes from functions/.secret.local when running emulated
 * (Secret Manager in production) and contains owner@example.com.
 */

const BOOTSTRAP_ADMIN = "owner@example.com";
let h: Harness;
let seq = 0;

const uniqueEmail = () => `person${(seq += 1)}-${Date.now()}@example.com`;

/** Waits for the async onUserCreate trigger, then reads the fresh claim. */
async function roleClaimOf(): Promise<string | undefined> {
  return waitFor(
    async () => {
      const token = await h.auth.currentUser?.getIdTokenResult(true);
      return token?.claims.role as string | undefined;
    },
    { label: "role claim stamped by onUserCreate" }
  );
}

beforeAll(() => { h = createHarness(); });

beforeEach(async () => {
  // Sign out explicitly: clearAuth deletes the emulator's accounts, but the
  // client still holds a signed token and the Functions emulator verifies the
  // signature rather than the account, so a caller would leak between tests.
  await h.auth.signOut().catch(() => {});
  await clearFirestore();
  await clearAuth();
});

afterAll(async () => { await h?.dispose(); });

describe("onUserCreate stamps the initial role", () => {
  it("makes an ordinary sign-up a client", async () => {
    await h.signUp(uniqueEmail());
    expect(await roleClaimOf()).toBe("client");
  });

  it("makes an email on the bootstrap allowlist an admin", async () => {
    // There is no admin yet to promote the first one, which is why the
    // allowlist exists at all.
    await h.signUp(BOOTSTRAP_ADMIN);
    expect(await roleClaimOf()).toBe("admin");
  });

  it("matches the allowlist case-insensitively", async () => {
    await h.signUp(BOOTSTRAP_ADMIN.toUpperCase());
    expect(await roleClaimOf()).toBe("admin");
  });

  it("writes a profile document the dashboard can render", async () => {
    const user = await h.signUp(uniqueEmail());
    const profile = await waitFor(
      async () => await adminGet(`users/${user.uid}`),
      { label: "profile document created" }
    );
    expect(profile).toMatchObject({
      uid: user.uid,
      role: "client",
      rid: RESTAURANT_ID,
      signupMethod: "password",
    });
    expect(profile.roleUpdatedAt).toBeTruthy();
  });

  it("stamps the claim with the restaurant, which the rules check", async () => {
    await h.signUp(uniqueEmail());
    await roleClaimOf();
    const token = await h.auth.currentUser!.getIdTokenResult();
    expect(token.claims.rid).toBe(RESTAURANT_ID);
  });
});

describe("setUserRole is admin only", () => {
  /** Signs in as the bootstrap admin with a token that carries the claim. */
  async function asAdmin(): Promise<string> {
    const admin = await h.signUp(BOOTSTRAP_ADMIN);
    expect(await roleClaimOf()).toBe("admin");
    return admin.uid;
  }

  it("refuses an anonymous caller", async () => {
    await expect(
      h.call("setUserRole", { uid: "someone", role: "admin" })
    ).rejects.toThrow(/unauthenticated|Sign in/i);
  });

  it("refuses a client trying to promote themselves", async () => {
    const user = await h.signUp(uniqueEmail());
    expect(await roleClaimOf()).toBe("client");
    await expect(
      h.call("setUserRole", { uid: user.uid, role: "admin" })
    ).rejects.toThrow(/permission-denied|Admins only/i);
  });

  it("lets an admin grant a staff role", async () => {
    const target = await h.signUp(uniqueEmail());
    const targetUid = target.uid;
    await roleClaimOf();
    await h.auth.signOut();
    await asAdmin();

    await h.call("setUserRole", { uid: targetUid, role: "restaurant" });

    const profile = await waitFor(
      async () => {
        const doc = await adminGet(`users/${targetUid}`);
        return doc?.role === "restaurant" ? doc : null;
      },
      { label: "role mirrored onto the profile" }
    );
    expect(profile.rid).toBe(RESTAURANT_ID);
  });

  it("bumps roleUpdatedAt, which is how a live browser learns to refresh", async () => {
    const target = await h.signUp(uniqueEmail());
    const targetUid = target.uid;
    await roleClaimOf();
    const before = (await adminGet(`users/${targetUid}`))?.roleUpdatedAt as string;

    await h.auth.signOut();
    await asAdmin();
    await h.call("setUserRole", { uid: targetUid, role: "restaurant" });

    const after = await waitFor(
      async () => {
        const stamp = (await adminGet(`users/${targetUid}`))?.roleUpdatedAt as string;
        return stamp && stamp !== before ? stamp : null;
      },
      { label: "roleUpdatedAt bumped" }
    );
    expect(Date.parse(after)).toBeGreaterThanOrEqual(Date.parse(before));
  });

  it.each([
    ["an unknown role", "superuser"],
    ["an empty role", ""],
  ])("rejects %s", async (_label, role) => {
    await asAdmin();
    await expect(
      h.call("setUserRole", { uid: "someone", role })
    ).rejects.toThrow(/invalid-argument|valid role/i);
  });

  it("rejects a missing uid", async () => {
    await asAdmin();
    await expect(
      h.call("setUserRole", { role: "client" })
    ).rejects.toThrow(/invalid-argument|uid/i);
  });

  it("refuses to let the last admin demote themselves", async () => {
    // Losing the last admin would leave nobody able to grant roles back.
    const adminUid = await asAdmin();
    await expect(
      h.call("setUserRole", { uid: adminUid, role: "client" })
    ).rejects.toThrow(/failed-precondition|own admin role/i);
  });

  it("lets an admin re-affirm their own admin role", async () => {
    const adminUid = await asAdmin();
    await expect(
      h.call("setUserRole", { uid: adminUid, role: "admin" })
    ).resolves.toMatchObject({ role: "admin" });
  });
});
