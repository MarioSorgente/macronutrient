import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  "@data": fileURLToPath(new URL("./data", import.meta.url)),
  // `server-only` throws by design when it is resolved outside a React Server
  // context — that is the whole point of it, and it is what stops the Admin
  // SDK reaching a client bundle. Tests run the server modules deliberately,
  // so here it resolves to nothing.
  "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
};

/**
 * Two projects, because the suites have different costs and prerequisites.
 *
 * `unit` is pure logic and jsdom components — no services, runs in seconds, and
 * is what `npm test` and a pre-commit hook should call.
 *
 * `integration` talks to the Firebase emulator suite (rules and Cloud
 * Functions). It needs `npm run emulators` alongside it, or `npm run
 * test:emulated`, which starts them, runs, and tears them down.
 *
 * No Vite plugins on purpose: @vitejs/plugin-react resolves a different major
 * of Vite than Vitest does, and the two type-clash. Everything the tests need
 * is the JSX transform and the path alias, both of which are one line here.
 */
export default defineConfig({
  resolve: { alias },
  // tsconfig sets `jsx: "preserve"` because Next compiles JSX itself. Vitest
  // has no Next pipeline, so it needs the automatic runtime spelled out or
  // components compile to bare `React.createElement` with no React in scope.
  esbuild: { jsx: "automatic" },
  test: {
    globals: false,
    projects: [
      {
        resolve: { alias },
        esbuild: { jsx: "automatic" },
        test: {
          name: "unit",
          environment: "node", // per-file `@vitest-environment jsdom` opts in
          include: ["src/**/*.test.{ts,tsx}"],
          globals: false,
        },
      },
      {
        resolve: { alias },
        esbuild: { jsx: "automatic" },
        test: {
          name: "bench",
          environment: "node",
          include: ["tests/bench/**/*.bench.ts"],
          globals: false,
        },
      },
      {
        resolve: { alias },
        esbuild: { jsx: "automatic" },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globals: false,
          // Points the Admin SDK at the emulator suite. Without these it would
          // look for real credentials and reach the live project.
          env: {
            FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
            FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
            GOOGLE_CLOUD_PROJECT: "demo-mamma",
            FIREBASE_PROJECT_ID: "demo-mamma",
            NEXT_PUBLIC_RESTAURANT_ID: "negrita",
            ADMIN_EMAILS: "owner@example.com,boss@negrita.test",
          },
          // Emulator round-trips and cold function starts are slow; the
          // default 5s fails on an honest run rather than a broken one.
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // Rules tests share one emulator project namespace, so parallel
          // files would clear each other's seed data mid-assertion. One fork
          // serialises them without slowing the unit project down.
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
