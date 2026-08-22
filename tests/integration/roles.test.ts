import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  RESTAURANT_ID,
  adminGet,
  clearAuth,
  clearFirestore,
  createHarness,
  setEmailVerified,
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

  it("does NOT make an allowlisted but unverified address an admin", async () => {
    // Firebase does not verify an address on password sign-up. Without this
    // check, anyone who knows the owner's address could register it first and
    // take the restaurant.
    await h.signUp(BOOTSTRAP_ADMIN);
    expect(await roleClaimOf()).toBe("client");
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
  /**
   * Signs in as the bootstrap admin with a token that carries the claim.
   *
   * Two steps, because the admin grant now requires a verified address:
   * sign-up alone makes them a client, and claimAdminAccess promotes them once
   * the address is confirmed. This is exactly the route a real owner takes.
   */
  async function asAdmin(): Promise<string> {
    const admin = await h.signUp(BOOTSTRAP_ADMIN);
    expect(await roleClaimOf()).toBe("client");
    await setEmailVerified(admin.uid);
    await h.auth.currentUser!.getIdToken(true);
    await h.call("claimAdminAccess", {});
    await h.auth.currentUser!.getIdTokenResult(true);
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

describe("claimAdminAccess — recovering from the bootstrap deadlock", () => {
  /**
   * The situation this exists for: `onUserCreate` stamps the role at sign-up
   * and never backfills, and `setUserRole` refuses anyone who is not already
   * an admin. So an account that missed its one chance had no route to admin
   * at all, and the app's only advice was to delete it and sign up again.
   */
  it("grants admin to an allowlisted address once it is verified", async () => {
    const user = await h.signUp(BOOTSTRAP_ADMIN);
    // Signed up before anything could make them an admin — the deadlock.
    expect(await roleClaimOf()).toBe("client");

    await setEmailVerified(user.uid);
    await h.auth.currentUser!.getIdToken(true);

    await expect(h.call("claimAdminAccess", {})).resolves.toMatchObject({
      role: "admin",
    });

    const token = await h.auth.currentUser!.getIdTokenResult(true);
    expect(token.claims.role).toBe("admin");
    expect(token.claims.rid).toBe(RESTAURANT_ID);
  });

  it("mirrors the role and bumps roleUpdatedAt so an open browser refreshes", async () => {
    const user = await h.signUp(BOOTSTRAP_ADMIN);
    await roleClaimOf();
    const before = (await adminGet(`users/${user.uid}`))?.roleUpdatedAt as string;

    await setEmailVerified(user.uid);
    await h.auth.currentUser!.getIdToken(true);
    await h.call("claimAdminAccess", {});

    const after = await waitFor(
      async () => {
        const doc = await adminGet(`users/${user.uid}`);
        return doc?.role === "admin" ? doc : null;
      },
      { label: "role mirrored onto the profile" }
    );
    expect(after.roleUpdatedAt).not.toBe(before);
  });

  it("is idempotent, so the app can call it opportunistically", async () => {
    const user = await h.signUp(BOOTSTRAP_ADMIN);
    await roleClaimOf();
    await setEmailVerified(user.uid);
    await h.auth.currentUser!.getIdToken(true);

    await h.call("claimAdminAccess", {});
    await expect(h.call("claimAdminAccess", {})).resolves.toMatchObject({
      role: "admin",
    });
  });

  it("refuses an address that is not on the allowlist", async () => {
    const user = await h.signUp(uniqueEmail());
    await roleClaimOf();
    await setEmailVerified(user.uid);
    await h.auth.currentUser!.getIdToken(true);

    await expect(h.call("claimAdminAccess", {})).rejects.toThrow(
      /permission-denied|owner allowlist/i
    );
  });

  it("refuses an allowlisted address that has not been verified", async () => {
    await h.signUp(BOOTSTRAP_ADMIN);
    await roleClaimOf();
    await expect(h.call("claimAdminAccess", {})).rejects.toThrow(
      /permission-denied|owner allowlist/i
    );
  });

  it("says the same thing either way, so it cannot be used to probe the list", async () => {
    // A precise message would turn this into an oracle for who is an owner.
    const onList = await h
      .signUp(BOOTSTRAP_ADMIN)
      .then(() => h.call("claimAdminAccess", {}))
      .catch((e: Error) => e.message);
    await h.auth.signOut();
    await clearAuth();
    const offList = await h
      .signUp(uniqueEmail())
      .then(() => h.call("claimAdminAccess", {}))
      .catch((e: Error) => e.message);
    expect(onList).toBe(offList);
  });

  it("refuses an anonymous caller", async () => {
    await expect(h.call("claimAdminAccess", {})).rejects.toThrow(
      /unauthenticated|Sign in/i
    );
  });

  it("does not let a claimed admin be a back door to any other role", async () => {
    // It grants exactly one role, and takes no arguments to twist.
    const user = await h.signUp(BOOTSTRAP_ADMIN);
    await roleClaimOf();
    await setEmailVerified(user.uid);
    await h.auth.currentUser!.getIdToken(true);
    await expect(
      h.call("claimAdminAccess", { role: "restaurant", uid: "someone-else" })
    ).resolves.toMatchObject({ role: "admin" });
    expect((await adminGet(`users/${user.uid}`))?.role).toBe("admin");
  });
});

describe("being on the allowlist is enough on its own", () => {
  /**
   * The expectation this has to meet, in the owner's words: "when I log in and
   * I am the ADMIN_EMAIL, I need to be admin automatically."
   *
   * The client calls claimAdminAccess on every sign-in for anyone who is not
   * already an admin, so no button has to be found and pressed. These assert
   * the server half of that: the same call, made twice across two separate
   * sign-ins, with no other action in between.
   */
  it("promotes an existing customer account on a later sign-in", async () => {
    // Sign up while nothing can grant admin — the account starts as a customer.
    const user = await h.signUp(BOOTSTRAP_ADMIN);
    expect(await roleClaimOf()).toBe("client");
    await setEmailVerified(user.uid);

    // Sign out, and back in, as a person would the next day.
    await h.auth.signOut();
    await h.signIn(BOOTSTRAP_ADMIN);

    // What the provider does automatically on that sign-in:
    await expect(h.call("claimAdminAccess", {})).resolves.toMatchObject({
      role: "admin",
    });
    const token = await h.auth.currentUser!.getIdTokenResult(true);
    expect(token.claims.role).toBe("admin");
  });

  it("costs an ordinary customer nothing but a refusal", async () => {
    // The same unconditional call every signed-in account makes. It must not
    // change anything for someone who is not an owner.
    const user = await h.signUp(uniqueEmail());
    expect(await roleClaimOf()).toBe("client");
    await setEmailVerified(user.uid);
    await h.auth.currentUser!.getIdToken(true);

    await expect(h.call("claimAdminAccess", {})).rejects.toThrow(
      /permission-denied|owner allowlist/i
    );
    const token = await h.auth.currentUser!.getIdTokenResult(true);
    expect(token.claims.role).toBe("client");
    expect((await adminGet(`users/${user.uid}`))?.role).toBe("client");
  });
});
