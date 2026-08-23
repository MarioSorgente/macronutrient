import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import {
  PROJECT_ID,
  RID,
  claimsOf,
  createUser,
  docAt,
  resetEmulators,
  uniqueEmail,
} from "./serverHarness";

/**
 * scripts/grant-role.mjs — the escape hatch.
 *
 * The app grants owner access on its own now, from the ADMIN_EMAILS allowlist.
 * This covers what that cannot: an address that is not on the list, and
 * granting `restaurant` before any admin exists to do it. Nobody runs it on a
 * normal day, so without a test it would rot unnoticed and only be discovered
 * by someone already locked out.
 */

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("../../scripts/grant-role.mjs", import.meta.url));

const ENV = {
  ...process.env,
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  GOOGLE_CLOUD_PROJECT: PROJECT_ID,
};

const grant = (email: string, role: string) =>
  run("node", [SCRIPT, email, role], { env: ENV });

beforeEach(resetEmulators);

describe("grant-role.mjs", () => {
  it("promotes an existing account and mirrors it for the UI", async () => {
    const email = uniqueEmail("owner");
    const uid = await createUser(email);

    const { stdout } = await grant(email, "admin");
    expect(stdout).toMatch(/none -> admin/);

    expect(await claimsOf(uid)).toMatchObject({ role: "admin", rid: RID });
    // roleUpdatedAt is not cosmetic: the client watches it to force exactly the
    // token refresh that makes this land in an already-open browser.
    const profile = await docAt(`users/${uid}`);
    expect(profile).toMatchObject({ role: "admin" });
    expect(profile?.roleUpdatedAt).toBeTruthy();
  });

  it("grants the restaurant role too", async () => {
    const email = uniqueEmail("cook");
    const uid = await createUser(email);
    await grant(email, "restaurant");
    expect(await claimsOf(uid)).toMatchObject({ role: "restaurant" });
  });

  it("refuses a role that does not exist", async () => {
    await expect(grant("someone@example.com", "wizard")).rejects.toThrow(/is not a role/);
  });

  it("says so plainly when the account does not exist", async () => {
    await expect(grant(uniqueEmail("ghost"), "admin")).rejects.toThrow(/No account exists/);
  });

  it("explains its usage when called with nothing", async () => {
    await expect(run("node", [SCRIPT], { env: ENV })).rejects.toThrow(/Usage:/);
  });
});
