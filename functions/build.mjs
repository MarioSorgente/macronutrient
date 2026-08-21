import { build } from "esbuild";
import { fileURLToPath } from "node:url";

/**
 * Bundles the functions into a single CommonJS file.
 *
 * `tsc` alone is not enough here: it does not rewrite the `@/…` path aliases
 * the server uses to import the app's own pricing and macro modules, and once
 * it pulls in files from outside functions/ it relocates the whole output tree.
 * Bundling resolves the aliases at build time and keeps the entry point where
 * package.json says it is.
 *
 * firebase-functions and firebase-admin stay external — they are real
 * dependencies installed in the deployed runtime, and bundling them would both
 * bloat the artifact and break the SDKs' own module resolution.
 */
await build({
  entryPoints: ["src/index.ts"],
  outfile: "lib/index.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  external: ["firebase-functions", "firebase-admin"],
  alias: {
    "@": fileURLToPath(new URL("../src", import.meta.url)),
    "@data": fileURLToPath(new URL("../data", import.meta.url)),
  },
  logLevel: "info",
});
