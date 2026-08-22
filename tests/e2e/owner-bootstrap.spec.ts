import { test, expect } from "@playwright/test";
import {
  OWNER_EMAIL,
  clearAuthAccounts,
  signIn,
  signUp,
  verifyEmail,
} from "./helpers";

/**
 * "When I log in and I am the ADMIN_EMAIL, I need to be admin automatically."
 *
 * That is the whole requirement, and it is what these assert — in a browser,
 * with nothing clicked but the sign-in button. No visit to /account, no
 * "Refresh my access", no script.
 *
 * It used to be impossible: onUserCreate stamps the role at sign-up and never
 * backfills, so an account that predated the deploy stayed a customer forever.
 */

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered on desktop");
  // The allowlisted address is fixed, so each test needs it unclaimed.
  await clearAuthAccounts();
});

/**
 * The owner's real sequence: an account that exists first, whose address is
 * confirmed afterwards, and which only then signs in again. Nothing here
 * visits /account or presses a button — that is the point.
 */
async function signInAsOwner(page: import("@playwright/test").Page) {
  await signUp(page, OWNER_EMAIL, "Mario Sorgente");
  await verifyEmail(OWNER_EMAIL);
  await page.locator('button[aria-label^="Account:"]').click();
  await page.locator('[role="menu"] button:has-text("Sign out")').click();
  await expect(page.locator("header").getByRole("link", { name: "Sign in" }))
    .toBeVisible();
  await signIn(page, OWNER_EMAIL);
}

test("an allowlisted owner becomes admin just by signing in", async ({ page }) => {
  // Sign up first. At this point the account is an ordinary customer — the
  // address is confirmed only afterwards, which is the realistic order.
  await signUp(page, OWNER_EMAIL, "Mario Sorgente");
  await verifyEmail(OWNER_EMAIL);

  // Sign out and back in, exactly as the owner would the next day.
  await page.locator('button[aria-label^="Account:"]').click();
  await page.locator('[role="menu"] button:has-text("Sign out")').click();
  await expect(page.locator("header").getByRole("link", { name: "Sign in" })).toBeVisible();

  await signIn(page, OWNER_EMAIL);

  // Admin, with nothing else touched.
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
  await expect(page.getByText(/owner access only|this area is for negrita staff/i))
    .toHaveCount(0);

  await page.goto("/kitchen");
  await expect(page.getByText(/this area is for negrita staff|no role yet/i))
    .toHaveCount(0);
});

test("an admin can preview the app as the restaurant", async ({ page }) => {
  await signInAsOwner(page);
  await expect(page.locator("header").getByRole("link", { name: "Admin", exact: true }))
    .toBeVisible({ timeout: 20_000 });

  await page.goto("/account");
  await expect(page.getByText("View as")).toBeVisible();
  await page.getByRole("button", { name: "restaurant", exact: true }).click();

  // The standing banner makes the preview unmissable and is always one click
  // from off. ("Viewing as" also appears as a row on /account, so this matches
  // the banner by its own control.)
  await expect(page.getByRole("button", { name: /back to admin/i })).toBeVisible();
  await page.goto("/kitchen");
  await expect(page.getByText(/this area is for negrita staff/i)).toHaveCount(0);
});

test("an ordinary customer is unaffected by the bootstrap attempt", async ({ page }) => {
  await signUp(page);
  await expect(page.locator("header").getByRole("link", { name: "Admin", exact: true }))
    .toHaveCount(0);
  await page.goto("/admin");
  await expect(page.getByText(/this area is for negrita staff|no role yet/i)).toBeVisible();
});
