import { spawnSync } from "node:child_process";
import {
  createPublicKey,
  generateKeyPairSync,
  type JsonWebKey,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * Can the server half of this app actually load on Vercel?
 *
 * It could not, for the whole of the first deploy after the Cloud Functions
 * moved into this app. `firebase-admin` is on Next's default
 * `serverExternalPackages` list, so it is never bundled: Vercel copies it into
 * the lambda and `require`s it. Inside it, `jwks-rsa` does a CommonJS
 * `require('jose')`, and `jose@6` is ESM-only. Vercel's loader has no
 * `require(esm)`, so importing `firebase-admin/auth` threw ERR_REQUIRE_ESM —
 * and since `src/lib/server/auth.ts` imports it, all four API routes were dead:
 * no role was ever stamped, and no order could be sent to the kitchen.
 *
 * Nothing in the rest of the suite can see this. Every other test runs
 * in-process on a Node that does support `require(esm)`, and the emulated
 * suite never even reaches `jwks-rsa`, because `verifyIdToken` skips signature
 * verification when FIREBASE_AUTH_EMULATOR_HOST is set.
 *
 * So this reproduces the deployed runtime instead of the emulator.
 */

const require_ = createRequire(import.meta.url);

/**
 * Runs a snippet on a Node that behaves like Vercel's loader.
 *
 * `--no-experimental-require-module` turns off exactly the one feature that
 * masks the bug locally. A Node old enough to reject the flag has no
 * `require(esm)` to disable, so there the bare run reproduces it anyway.
 */
function requireUnderCjsOnly(snippet: string) {
  const strict = spawnSync(
    process.execPath,
    ["--no-experimental-require-module", "-e", snippet],
    { encoding: "utf8" }
  );
  const unsupported =
    strict.status !== 0 &&
    /bad option|not allowed|--no-experimental-require-module/i.test(
      strict.stderr ?? ""
    );
  return unsupported
    ? spawnSync(process.execPath, ["-e", snippet], { encoding: "utf8" })
    : strict;
}

describe("the server bundle on Vercel", () => {
  it("loads firebase-admin without require(esm)", () => {
    const result = requireUnderCjsOnly(
      "require('firebase-admin/auth'); require('firebase-admin/firestore');"
    );

    expect(
      result.status,
      `firebase-admin cannot be required from CommonJS, so every /api route ` +
        `returns 500 on Vercel. Most likely the "overrides" block pinning jose ` +
        `for jwks-rsa was removed from package.json.\n\n${result.stderr}`
    ).toBe(0);
    // Alone this takes well under a second. It spawns a cold Node and loads the
    // whole Admin SDK, though, and it runs beside the CPU-bound planner suites —
    // so what the project's 20 s default measures here is how busy the machine
    // is, which is the one thing this test is not about.
  }, 120_000);

  it("resolves a jose build that CommonJS can require", () => {
    const jwksRsa = require_.resolve("jwks-rsa/package.json");
    const josePath = createRequire(jwksRsa).resolve("jose/package.json");
    const jose = require_(josePath) as {
      version: string;
      exports: Record<string, Record<string, string>>;
    };

    // The invariant, stated directly, so a failure explains itself rather than
    // surfacing as a stack trace from somewhere inside the Admin SDK.
    expect(
      jose.exports["."].require,
      `jose ${jose.version} publishes no "require" condition, so jwks-rsa's ` +
        `require('jose') can only work on a runtime with require(esm).`
    ).toBeTruthy();
  });

  it("still derives a correct public key through the pinned jose", async () => {
    // Loading is not enough — this is the code path that verifies every ID
    // token, so a jose that imports but computes the wrong key would hand out
    // 401s (or, far worse, accept something it should not).
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;

    const josePath = createRequire(
      require_.resolve("jwks-rsa/package.json")
    ).resolve("jose");
    const jose = require_(josePath) as {
      importJWK: (jwk: JsonWebKey, alg: string) => Promise<unknown>;
      exportSPKI: (key: never) => Promise<string>;
    };

    // Exactly what jwks-rsa/src/utils.js does with each key in the JWKS.
    const imported = await jose.importJWK({ ...jwk, ext: true }, "RS256");
    const pem = await jose.exportSPKI(imported as never);

    expect(pem).toBe(
      createPublicKey({ key: jwk, format: "jwk" }).export({
        type: "spki",
        format: "pem",
      })
    );
  });

  it("keeps the Admin SDK out of the browser bundle", () => {
    // `server-only` is what enforces this at build time; this asserts the
    // import is still there, because losing it would ship a private key.
    const source = readFileSync(
      new URL("./firebaseAdmin.ts", import.meta.url),
      "utf8"
    );
    expect(source).toMatch(/^import "server-only";/m);
  });
});
