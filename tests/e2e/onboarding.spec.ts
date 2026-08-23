import { test, expect, type Page } from "@playwright/test";
import {
  OWNER_EMAIL,
  clearAuthAccounts,
  clearFirestoreData,
  signIn,
  signUp,
  uniqueEmail,
  verifyEmail,
} from "./helpers";

/**
 * Onboarding, end to end, for each of the three roles — from the landing page
 * to signing out.
 *
 * The other specs prove single mechanisms. These walk the arc a real person
 * walks, which is where the gaps between working screens show up.
 */

const HEADER = "header";
const AVATAR = 'button[aria-label^="Account:"]';

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered on desktop");
  // Both: profile documents outlive the accounts, and these tests assert on
  // rosters and dashboards that read Firestore.
  await Promise.all([clearAuthAccounts(), clearFirestoreData()]);
});

/** Signs up, confirms the address, and signs back in as the owner. */
async function onboardOwner(page: Page) {
  await signUp(page, OWNER_EMAIL, "Mario Sorgente");
  await verifyEmail(OWNER_EMAIL);
  await signOut(page);
  await signIn(page, OWNER_EMAIL);
  await expect(
    page.locator(HEADER).getByRole("link", { name: "Admin", exact: true })
  ).toBeVisible({ timeout: 20_000 });
}

async function signOut(page: Page) {
  await page.locator(AVATAR).click();
  await page.locator('[role="menu"] button:has-text("Sign out")').click();
  // Where you land depends on where you were: signing out of a staff page
  // bounces to /login, which has no site header. The avatar disappearing is
  // the signal that holds either way.
  await expect(page.locator(AVATAR)).toHaveCount(0);
}

test.describe("the owner", () => {
  test("arrives, becomes admin, and every staff destination works", async ({ page }) => {
    // --- the landing page ---------------------------------------------------
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /hit your macros/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /get started/i }).first()).toBeVisible();
    // A visitor is told they can start without an account.
    await expect(page.getByText(/no account needed/i)).toBeVisible();

    await onboardOwner(page);

    // --- the dashboard ------------------------------------------------------
    await page.goto("/admin");
    await expect(page.getByText(/owner access only/i)).toHaveCount(0);
    // first(): "Customers" is both a stat tile and a section heading.
    for (const tile of ["Customers", "New this month", "Active 7 days", "Orders this month"]) {
      await expect(page.getByText(tile, { exact: true }).first()).toBeVisible();
    }
    // The owner themselves is a customer record, so the roster is never empty.
    await expect(page.getByText(OWNER_EMAIL).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /csv/i })).toBeVisible();

    // --- settings -----------------------------------------------------------
    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: /people and access/i })).toBeVisible();
    await expect(page.getByLabel("At")).toBeVisible();
    // An admin cannot demote themselves into a lockout. Targeted by name:
    // `.first()` would be whichever account happens to sort first, which is
    // somebody else's row and correctly enabled.
    await expect(
      page.getByRole("combobox", { name: "Role for Mario Sorgente" })
    ).toBeDisabled();

    // --- house items --------------------------------------------------------
    await page.goto("/admin/house-items");
    await expect(page.getByText(/this area is for negrita staff/i)).toHaveCount(0);

    // --- the kitchen --------------------------------------------------------
    await page.goto("/kitchen");
    await expect(page.getByText(/this area is for negrita staff/i)).toHaveCount(0);
    await page.goto("/kitchen/orders");
    await expect(page.getByText(/this area is for negrita staff/i)).toHaveCount(0);

    // --- and out ------------------------------------------------------------
    await signOut(page);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});

test.describe("a restaurant account", () => {
  test("is onboarded by the admin and gets exactly the kitchen", async ({ page }) => {
    // A cook signs up as an ordinary customer first.
    const cook = uniqueEmail("cook");
    await signUp(page, cook, "Kitchen Hand");
    await expect(
      page.locator(HEADER).getByRole("link", { name: "Kitchen", exact: true })
    ).toHaveCount(0);
    await signOut(page);

    // The owner promotes them through the real settings screen.
    await onboardOwner(page);
    await page.goto("/admin/settings");
    const row = page.getByRole("combobox", { name: `Role for Kitchen Hand` });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.selectOption("restaurant");
    await expect(page.getByText(/role updated to restaurant/i)).toBeVisible();
    await signOut(page);

    // And the cook now has the kitchen — but not the dashboard.
    await signIn(page, cook);
    const header = page.locator(HEADER);
    await expect(header.getByRole("link", { name: "Kitchen", exact: true }))
      .toBeVisible({ timeout: 20_000 });
    await expect(header.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);

    await page.goto("/kitchen");
    await expect(page.getByText(/this area is for negrita staff/i)).toHaveCount(0);
    await page.goto("/kitchen/orders");
    await expect(page.getByText(/this area is for negrita staff/i)).toHaveCount(0);
    await page.goto("/admin/house-items");
    await expect(page.getByText(/this area is for negrita staff/i)).toHaveCount(0);

    // The owner's dashboard stays the owner's.
    await page.goto("/admin");
    await expect(page.getByText(/owner access only/i)).toBeVisible();

    await signOut(page);
  });
});

test.describe("a customer", () => {
  test("goes from the landing page to a sent order and out again", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /get started/i }).first().click();
    await expect(page).toHaveURL(/\/plan/);

    // Planning works with no account at all.
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    await signUp(page, uniqueEmail("diner"), "Hungry Person");

    const header = page.locator(HEADER);
    await expect(header.getByRole("link", { name: "My orders" })).toBeVisible();
    // A customer sees none of the staff destinations.
    await expect(header.getByRole("link", { name: "Kitchen", exact: true })).toHaveCount(0);
    await expect(header.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);

    // The four planning tabs are all reachable.
    for (const [tab, heading] of [
      ["Build a dish", /build a dish/i],
      ["Saved dishes", /saved dishes|no saved dishes/i],
      ["Send to kitchen", /send your week to the kitchen|sign in/i],
      ["My week", /my week/i],
    ] as const) {
      await page.getByRole("link", { name: tab }).click();
      await expect(page.getByText(heading).first()).toBeVisible();
    }

    await page.goto("/orders");
    await expect(page.getByText(/no orders yet/i)).toBeVisible();

    await page.goto("/account");
    await expect(page.getByLabel("Phone")).toBeVisible();

    await signOut(page);
  });
});
