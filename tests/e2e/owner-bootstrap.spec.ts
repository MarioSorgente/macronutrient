import { test, expect } from "@playwright/test";
import {
  OWNER_EMAIL,
  clearAuthAccounts,
  seedAdminProfileByEmail,
  signIn,
  signUp,
  verifyEmail,
} from "./helpers";

/**
 * Owner journeys start with a confirmed, privileged emulator account.
 *
 * The server role reconciliation itself is covered by serverRoles.test.ts.
 * These browser tests exercise the protected navigation and pages, so their
 * setup seeds the authoritative claim and profile through the Admin SDK. That
 * removes timing between reconciliation and the first UI assertion from the
 * behavior these tests are intended to cover.
 */

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered on desktop");
  // The allowlisted address is fixed, so each test needs it unclaimed.
  await clearAuthAccounts();
});

/**
 * Creates the owner, confirms it, seeds its server-owned role, and signs in.
 */
async function signInAsOwner(page: import("@playwright/test").Page) {
  await signUp(page, OWNER_EMAIL, "Mario Sorgente");
  await verifyEmail(OWNER_EMAIL);
  await seedAdminProfileByEmail(OWNER_EMAIL);
  await page.locator('button[aria-label^="Account:"]').click();
  await page.locator('[role="menu"] button:has-text("Sign out")').click();
  await expect(page.locator("header").getByRole("link", { name: "Sign in" }))
    .toBeVisible();
  await signIn(page, OWNER_EMAIL);
}

test("a seeded owner signs in with admin navigation", async ({ page }) => {
  // Sign up first. At this point the account is an ordinary customer — the
  // address is confirmed only afterwards, which is the realistic order.
  await signUp(page, OWNER_EMAIL, "Mario Sorgente");
  await verifyEmail(OWNER_EMAIL);
  await seedAdminProfileByEmail(OWNER_EMAIL);

  // Sign out and back in, exactly as the owner would the next day.
  await page.locator('button[aria-label^="Account:"]').click();
  await page.locator('[role="menu"] button:has-text("Sign out")').click();
  await expect(page.locator("header").getByRole("link", { name: "Sign in" })).toBeVisible();

  await signIn(page, OWNER_EMAIL);

  // The freshly issued token contains the seeded claim.
  const nav = page.locator("header");
  await expect(nav.getByRole("link", { name: "Admin", exact: true }))
    .toBeVisible({ timeout: 20_000 });
  await expect(nav.getByRole("link", { name: "Kitchen", exact: true })).toBeVisible();
});

test("and the dashboard and kitchen actually open", async ({ page }) => {
  await signInAsOwner(page);
  await expect(page.locator("header").getByRole("link", { name: "Admin", exact: true }))
    .toBeVisible({ timeout: 20_000 });

  await page.goto("/admin");
  await expect(page.getByText(/owner access only|restaurant staff access is required/i))
    .toHaveCount(0);

  await page.goto("/kitchen");
  await expect(page.getByText(/restaurant staff access is required/i))
    .toHaveCount(0);
});

test("an admin can preview the app as the restaurant", async ({ page }) => {
  await signInAsOwner(page);
  await expect(page.locator("header").getByRole("link", { name: "Admin", exact: true }))
    .toBeVisible({ timeout: 20_000 });

  await page.goto("/account");
  await expect(page.getByText("View as")).toBeVisible();
  await page.getByRole("button", { name: "Staff", exact: true }).click();

  // The standing banner makes the preview unmissable and is always one click
  // from off. ("Viewing as" also appears as a row on /account, so this matches
  // the banner by its own control.)
  await expect(page.getByRole("button", { name: /back to admin/i })).toBeVisible();
  await page.goto("/kitchen");
  await expect(page.getByText(/restaurant staff access is required/i)).toHaveCount(0);
});

test("an ordinary customer is unaffected by the bootstrap attempt", async ({ page }) => {
  await signUp(page);
  await expect(page.locator("header").getByRole("link", { name: "Admin", exact: true }))
    .toHaveCount(0);
  await page.goto("/admin");
  // Not the dashboard, and not a locked door either: the staff-access flow.
  await expect(
    page.getByRole("heading", { name: /restaurant staff access is required/i })
  ).toBeVisible({ timeout: 20_000 });
});

test('"Refresh my access" asks the server, not just the token', async ({
  page,
}) => {
  // Counted rather than inferred from the resulting role. The obvious version
  // of this test — become admin by pressing the button — passed against a
  // button that did nothing, because the automatic sign-in check had already
  // granted the role; and the version that dodged that by never reloading was
  // flaky, because the role flipping mid-render kept detaching the button.
  // What actually distinguishes a working button is that it talks to the
  // server, so that is what is asserted.
  let syncCalls = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/auth/sync")
    ) {
      syncCalls += 1;
    }
  });

  await signUp(page, OWNER_EMAIL, "Mario Sorgente");
  await verifyEmail(OWNER_EMAIL);
  await seedAdminProfileByEmail(OWNER_EMAIL);
  await page.goto("/account");

  const button = page.getByRole("button", { name: "Refresh my access" });
  await expect(button).toBeVisible();
  // Let the automatic check finish, so what is counted next can only be the
  // button's own call.
  await expect.poll(() => syncCalls, { timeout: 20_000 }).toBeGreaterThan(0);
  const before = syncCalls;

  // The button called the `claimAdminAccess` Cloud Function until now, and
  // swallowed the failure. That function no longer exists — the server moved
  // into this app — so the call could only ever fail, and the swallow meant the
  // button reported "no role" as though the allowlist had rejected you.
  await button.click();
  await expect.poll(() => syncCalls, { timeout: 20_000 }).toBeGreaterThan(before);
  await expect(page.getByText(/your account type is owner/i)).toBeVisible({
    timeout: 20_000,
  });
});
