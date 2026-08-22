import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PROJECT_ID,
  RID,
} from "./helpers";
import {
  adminGet,
  clearAuth,
  clearFirestore,
  createHarness,
  waitFor,
  type Harness,
} from "./appHarness";

/**
 * functions/scripts/grant-role.mjs — the escape hatch.
 *
 * It is the only way to grant a role when the Cloud Functions are not deployed
 * yet, which is exactly the situation that leaves the first owner with no
 * route to admin. Nobody runs it on a normal day, so without a test it would
 * rot unnoticed and only be discovered by someone already locked out.
 */

const run = promisify(execFile);
const SCRIPT = fileURLToPath(
  new URL("../../functions/scripts/grant-role.mjs", import.meta.url)
);

const ENV = {
  ...process.env,
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  GOOGLE_CLOUD_PROJECT: PROJECT_ID,
};

function grant(email: string, role: string) {
  return run("node", [SCRIPT, email, role], { env: ENV });
}

let h: Harness;
let seq = 0;

beforeAll(() => { h = createHarness(); });

beforeEach(async () => {
  await h.auth.signOut().catch(() => {});
  await clearFirestore();
  await clearAuth();
});

afterAll(async () => { await h?.dispose(); });

describe("grant-role.mjs", () => {
  it("promotes an existing account and mirrors it for the UI", async () => {
    const email = `owner${(seq += 1)}-${Date.now()}@example.com`;
    const user = await h.signUp(email);

    const { stdout } = await grant(email, "admin");
    // Reports the transition. The previous role is "client" once the sign-up
    // trigger has run and "none" if it has not yet — either is a real state.
    expect(stdout).toMatch(/(none|client) -> admin/);

    // The claim is the authority the security rules read.
    const token = await h.auth.currentUser!.getIdTokenResult(true);
    expect(token.claims.role).toBe("admin");
    expect(token.claims.rid).toBe(RID);

    // roleUpdatedAt is not cosmetic: AuthProvider watches it to force exactly
    // the refresh above in a browser that is already open.
    const profile = await waitFor(
      async () => {
        const doc = await adminGet(`users/${user.uid}`);
        return doc?.role === "admin" ? doc : null;
      },
      { label: "role mirrored onto the profile" }
    );
    expect(profile.roleUpdatedAt).toBeTruthy();
  });

  it("grants the restaurant role too", async () => {
    const email = `cook${(seq += 1)}-${Date.now()}@example.com`;
    await h.signUp(email);
    await grant(email, "restaurant");
    const token = await h.auth.currentUser!.getIdTokenResult(true);
    expect(token.claims.role).toBe("restaurant");
  });

  it("refuses a role that does not exist", async () => {
    await expect(grant("someone@example.com", "wizard")).rejects.toThrow(
      /is not a role/
    );
  });

  it("says so plainly when the account does not exist", async () => {
    await expect(grant(`ghost-${Date.now()}@example.com`, "admin")).rejects.toThrow(
      /No account exists/
    );
  });

  it("explains its usage when called with nothing", async () => {
    await expect(run("node", [SCRIPT], { env: ENV })).rejects.toThrow(/Usage:/);
  });
});
