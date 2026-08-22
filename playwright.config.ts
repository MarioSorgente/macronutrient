import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a real browser, a real Next dev server and the
 * Firebase emulator suite.
 *
 * Run with `npm run e2e`, which wraps this in `firebase emulators:exec` so the
 * emulators are up for the whole run and torn down afterwards.
 *
 * Two viewports on purpose. Several of the user-action findings this suite
 * guards are only reachable on a phone — the account menu used to sit inside a
 * horizontally scrolling nav, where it was both clipped and scrolled out of
 * reach.
 */

/**
 * Deliberately fake Firebase config. The emulators accept any project
 * credentials; everything real is enforced by firestore.rules and the Cloud
 * Functions. Kept here rather than in a .env file because `.env*.local` is
 * gitignored and CI needs these committed.
 */
const EMULATOR_ENV = {
  NEXT_PUBLIC_STORAGE_BACKEND: "firebase",
  NEXT_PUBLIC_FIREBASE_API_KEY: "emulator-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-mamma.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-mamma",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo-mamma.appspot.com",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "1",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:1:web:1",
  NEXT_PUBLIC_RESTAURANT_ID: "negrita",
  NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "true",
};

const PORT = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // one emulator project; parallel specs would clash
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : [["list"]],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Chromium ships with this image at a fixed path; never run
    // `playwright install` here.
    launchOptions: { executablePath: "/opt/pw-browsers/chromium" },
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 667 } },
    },
  ],

  /**
   * A production build, not `next dev`.
   *
   * The dev server compiles each route lazily on its first request, which added
   * whole seconds at unpredictable points and made the long journeys flaky at
   * roughly one run in two. Building once removes that variance — and means
   * these tests exercise the bundle that actually ships, including the
   * build-time inlining of every NEXT_PUBLIC_* value.
   */
  webServer: {
    command: `npx next build && npx next start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: EMULATOR_ENV,
  },
});
