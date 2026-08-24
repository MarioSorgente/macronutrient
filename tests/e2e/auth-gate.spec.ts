import { test, expect, type Page } from "@playwright/test";
import {
  OWNER_EMAIL,
  clearAuthAccounts,
  clearFirestoreData,
  dbGet,
  dbList,
  mondayAhead,
  seedLegacyGuestPlan,
  signIn,
  signUp,
  signUpStaff,
  uniqueEmail,
  until,
  verifyEmail,
} from "./helpers";

/**
 * Mandatory authentication, in a real browser.
 *
 * The product used to open straight into a guest planner, and staff onboarding
 * existed only for whoever guessed the `/signup` URL. These walk the front door
 * the way a person does: the two CTAs, the redirect that brings you back where
 * you were, and the staff arc from "I work at Negrita" through owner approval
 * to a kitchen that actually opens.
 */

const AVATAR = 'button[aria-label^="Account:"]';
const HEADER = "header";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered on desktop");
  await Promise.all([clearAuthAccounts(), clearFirestoreData()]);
});

async function signOut(page: Page) {
  await page.locator(AVATAR).click();
  await page.locator('[role="menu"] button:has-text("Sign out")').click();
  await expect(page.locator(AVATAR)).toHaveCount(0);
}

test.describe("the landing page", () => {
  test("names both journeys and neither one opens the planner", async ({ page }) => {
    await page.goto("/");

    const customer = page.getByRole("link", { name: /plan my meals/i }).first();
    const staff = page.getByRole("link", { name: /i work at negrita/i }).first();
    await expect(customer).toBeVisible();
    await expect(staff).toBeVisible();
    await expect(customer).toHaveAttribute("href", "/signup?intent=customer&next=%2Fplan");
    await expect(staff).toHaveAttribute("href", "/signup?intent=staff&next=%2Fkitchen");

    // And the promise that used to sit under them is gone.
    await expect(page.getByText(/no account needed/i)).toHaveCount(0);
    await expect(
      page.locator(HEADER).getByRole("link", { name: "Sign in", exact: true })
    ).toBeVisible();
    await expect(
      page.locator(HEADER).getByRole("link", { name: "Create account" })
    ).toBeVisible();
  });
});

test.describe("a signed-out visitor", () => {
  for (const [path, next] of [
    ["/plan", "%2Fplan"],
    ["/plan/build", "%2Fplan%2Fbuild"],
    ["/orders", "%2Forders"],
    ["/account", "%2Faccount"],
    ["/report/anything", "%2Freport%2Fanything"],
  ] as const) {
    test(`cannot open ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${next}$`), {
        timeout: 15_000,
      });
      // Not merely redirected: the screen behind is not rendered either.
      await expect(page.getByRole("button", { name: "Settings" })).toHaveCount(0);
    });
  }

  test("is sent to /kitchen's login with staff intent intact", async ({ page }) => {
    await page.goto("/kitchen");
    await expect(page).toHaveURL(/\/login\?intent=staff&next=%2Fkitchen/, {
      timeout: 15_000,
    });
    await expect(page.getByText(/signing in to work at negrita/i)).toBeVisible();
  });

  test("cannot reach /admin either", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?intent=staff&next=%2Fadmin/, {
      timeout: 15_000,
    });
  });
});

test.describe("the destination is carried through sign-in", () => {
  test("and honoured for /orders", async ({ page }) => {
    const email = await signUp(page);
    await signOut(page);

    await page.goto("/orders");
    await expect(page).toHaveURL(/\/login\?next=%2Forders/, { timeout: 15_000 });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/orders$/, { timeout: 30_000 });
    await expect(page.getByText(/no orders yet/i)).toBeVisible();
  });

  /**
   * `next` is the one value on this screen an attacker chooses, and it used to
   * be handed straight to the router.
   */
  test("but never off this site", async ({ page }) => {
    const email = await signUp(page);
    await signOut(page);

    await page.goto("/login?next=https://evil.example");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 30_000,
    });
    expect(page.url()).not.toContain("evil.example");
    await expect(page).toHaveURL(/\/plan/);
  });

  test("and a protocol-relative destination is refused too", async ({ page }) => {
    const email = await signUp(page);
    await signOut(page);

    await page.goto("/login?next=//evil.example");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/plan/, { timeout: 30_000 });
  });
});

test.describe("an authenticated customer", () => {
  /**
   * Firebase reports "signed out" for the first frame of every load. Acting on
   * that would bounce somebody to the login screen every time they refreshed.
   */
  test("refreshing the planner is never shown the login form", async ({ page }) => {
    await signUp(page);
    await page.goto("/plan");
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.reload();
      await expect(page.getByRole("button", { name: "Settings" })).toBeVisible({
        timeout: 20_000,
      });
      expect(page.url()).not.toContain("/login");
    }
  });

  test("opening the kitchen is offered the way in, not a locked door", async ({ page }) => {
    await signUp(page);
    await page.goto("/kitchen");

    await expect(
      page.getByRole("heading", { name: /restaurant staff access is required/i })
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("button", { name: "Request staff access" })
    ).toBeVisible();
    // The board itself never renders.
    await expect(page).toHaveURL(/\/kitchen$/);
  });

  test("loses access to protected screens the moment they sign out", async ({ page }) => {
    await signUp(page);
    await page.goto("/plan");
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();

    await signOut(page);
    await page.goto("/plan");

    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Settings" })).toHaveCount(0);
  });
});

test.describe("staff onboarding", () => {
  test("a new employee waits for approval, then activates and gets the kitchen", async ({ page }) => {
    // --- the employee asks --------------------------------------------------
    const cook = await signUpStaff(page, uniqueEmail("cook"));
    await expect(page.getByText(/waiting for owner approval/i)).toBeVisible({
      timeout: 20_000,
    });
    // Firebase does not confirm an address on password sign-up, and an
    // unconfirmed one is the quiet reason approval never comes.
    await expect(
      page.getByText(/confirm your email before the restaurant owner/i)
    ).toBeVisible();

    const request = await until(
      async () => (await dbList("restaurants/negrita/staffRequests"))[0],
      "the staff request to be filed by the signup"
    );
    expect(request.status).toBe("pending");
    expect(request.email).toBe(cook.toLowerCase());

    // A customer claim, not a staff one: the client cannot promote itself.
    const profile = await until(
      async () => await dbGet(`users/${request.uid}`),
      "the profile to be stamped"
    );
    expect(profile?.role).toBe("client");

    await verifyEmail(cook);
    await signOut(page);

    // --- the owner approves -------------------------------------------------
    await signUp(page, OWNER_EMAIL, "Mario Sorgente");
    await verifyEmail(OWNER_EMAIL);
    await signOut(page);
    await signIn(page, OWNER_EMAIL);

    await page.goto("/admin/settings");
    const approve = page.getByRole("button", { name: "Approve" });
    await expect(approve).toBeEnabled({ timeout: 20_000 });
    await approve.click();
    await until(
      async () => (await dbList("restaurants/negrita/staffRequests"))[0]?.status === "approved",
      "the request to be approved server-side"
    );
    await signOut(page);

    // --- and the employee gets in -------------------------------------------
    await signIn(page, cook);
    await page.goto("/kitchen");
    await expect(
      page.getByRole("heading", { name: /restaurant staff access is required/i })
    ).toHaveCount(0, { timeout: 30_000 });
    await expect(
      page.locator(HEADER).getByRole("link", { name: "Kitchen", exact: true })
    ).toBeVisible({ timeout: 20_000 });
  });

  test("an unconfirmed address cannot be approved", async ({ page }) => {
    const cook = await signUpStaff(page, uniqueEmail("unconfirmed"));
    await expect(page.getByText(/waiting for owner approval/i)).toBeVisible({
      timeout: 20_000,
    });
    await signOut(page);

    await signUp(page, OWNER_EMAIL, "Mario Sorgente");
    await verifyEmail(OWNER_EMAIL);
    await signOut(page);
    await signIn(page, OWNER_EMAIL);

    await page.goto("/admin/settings");
    // first(): the address appears in the request card and again in the roster.
    await expect(page.getByText(cook.toLowerCase()).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect(page.getByText(/email not verified/i)).toBeVisible();
  });

  /**
   * The case the old flow could not serve at all: somebody who works in the
   * kitchen but signed up months ago as a diner. Clicking "I work at Negrita"
   * sent them to /login, and logging in dropped them back on the planner.
   */
  test("an existing customer asks from the staff door without a second account", async ({ page }) => {
    const email = await signUp(page, uniqueEmail("regular"));
    await signOut(page);

    await page.goto("/");
    await page.getByRole("link", { name: /i work at negrita/i }).first().click();
    await expect(page).toHaveURL(/\/signup\?intent=staff/);

    // They already have an account, so they take the Sign in link — which must
    // not drop the intent on the way.
    await page.getByRole("link", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login\?intent=staff&next=%2Fkitchen/);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/account\?staff-requested=1/, { timeout: 30_000 });
    await expect(page.getByText(/waiting for owner approval/i)).toBeVisible({
      timeout: 20_000,
    });

    const requests = await until(
      async () => {
        const found = await dbList("restaurants/negrita/staffRequests");
        return found.length > 0 ? found : null;
      },
      "the staff request to be filed for the existing account"
    );
    expect(requests).toHaveLength(1);
  });

  test("an owner following the staff door lands in the kitchen, filing nothing", async ({ page }) => {
    await signUp(page, OWNER_EMAIL, "Mario Sorgente");
    await verifyEmail(OWNER_EMAIL);
    await signOut(page);

    await page.goto("/login?intent=staff&next=%2Fkitchen");
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/kitchen$/, { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: /restaurant staff access is required/i })
    ).toHaveCount(0);
    expect(await dbList("restaurants/negrita/staffRequests")).toHaveLength(0);
  });
});

test.describe("a plan belongs to the account", () => {
  test("survives navigating away, coming back, and a reload", async ({ page }) => {
    await signUp(page);

    await page.goto("/plan");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Program starts").fill(mondayAhead(2));
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByLabel("Program starts")).toBeHidden();

    await until(
      async () => {
        for (const user of await dbList("users")) {
          const plan = await dbGet(`users/${user.uid}/plans/primary`);
          if (plan?.programStartDate === mondayAhead(2)) return true;
        }
        return false;
      },
      "the plan to reach the account"
    );

    await page.goto("/orders");
    await page.goto("/plan");
    await page.reload();

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByLabel("Program starts")).toHaveValue(mondayAhead(2));
  });

  /**
   * Nothing creates guest data any more, but devices that used the planner
   * before accounts were required still hold a week. Losing it at the moment
   * somebody commits to an account is the worst possible trade.
   */
  test("claims a week left behind by the old guest planner", async ({ page }) => {
    await seedLegacyGuestPlan(page, { programStartDate: mondayAhead(2), meals: 2 });
    await signUp(page, uniqueEmail("legacy"));

    const claimed = await until(
      async () => {
        for (const user of await dbList("users")) {
          const plan = await dbGet(`users/${user.uid}/plans/primary`);
          if (Array.isArray(plan?.assignments) && plan.assignments.length === 2) {
            return plan;
          }
        }
        return null;
      },
      "the legacy week to be claimed into the account"
    );
    expect(claimed.programStartDate).toBe(mondayAhead(2));

    // And the device copy is cleared, so it cannot be claimed twice.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("mamma-calories:clients")), {
        timeout: 15_000,
      })
      .toBeNull();
  });
});
