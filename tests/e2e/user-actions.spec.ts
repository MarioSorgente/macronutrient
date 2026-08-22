import { test, expect } from "@playwright/test";
import { isHitTestable, isOnScreen, signIn, signUp, uniqueEmail } from "./helpers";

/**
 * The user-action inventory: every action a person needs, checked in a real
 * browser at both a desktop and a phone viewport.
 *
 * The regressions these guard were all real:
 *   - Sign out lived only inside the avatar dropdown, which sat in a
 *     horizontally scrolling <nav>. `overflow-x: auto` forces the computed
 *     `overflow-y` to `auto`, so the dropdown was clipped: hit-testing the
 *     centre of the "Sign out" row returned the page behind it. At 375px the
 *     avatar itself was laid out past the right edge of the screen.
 *   - /account had no sign-out at all, and the receipt and report pages
 *     rendered with no header, so there was no account menu on them either.
 *   - phone and defaultAddress were read by submitOrder and shown to staff,
 *     but no screen ever wrote them.
 */

const AVATAR = 'button[aria-label^="Account:"]';
const SIGN_OUT = '[role="menu"] button:has-text("Sign out")';

test.describe("signing out", () => {
  test("the avatar is on screen and its menu is clickable where it appears", async ({ page }) => {
    await signUp(page);

    expect(await isOnScreen(page, AVATAR), "avatar within the viewport").toBe(true);
    expect(await isHitTestable(page, AVATAR), "avatar clickable").toBe(true);

    await page.locator(AVATAR).click();
    // The check that actually caught the bug: laid out AND painted on top.
    expect(await isHitTestable(page, SIGN_OUT), "Sign out clickable where shown")
      .toBe(true);
  });

  test("signs the user out and returns them to the landing page", async ({ page }) => {
    await signUp(page);
    await page.locator(AVATAR).click();
    await page.locator(SIGN_OUT).click();

    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    // And it really is a sign-out, not just a redirect.
    await page.goto("/orders");
    await expect(page.getByText(/sign in to see your orders/i)).toBeVisible();
  });

  test.describe("is reachable from every signed-in page", () => {
    for (const path of ["/plan", "/plan/build", "/plan/dishes", "/plan/submit", "/orders", "/account"]) {
      test(`on ${path}`, async ({ page }) => {
        await signUp(page);
        await page.goto(path);
        expect(await isOnScreen(page, AVATAR), `avatar on ${path}`).toBe(true);
        await page.locator(AVATAR).click();
        expect(await isHitTestable(page, SIGN_OUT), `Sign out on ${path}`).toBe(true);
      });
    }
  });

  test("is reachable on a printable report, which has no site header", async ({ page }) => {
    await signUp(page);
    await page.goto("/plan/report");
    expect(await isOnScreen(page, AVATAR), "avatar on the plan report").toBe(true);
    await page.locator(AVATAR).click();
    expect(await isHitTestable(page, SIGN_OUT)).toBe(true);
  });

  test("/account offers its own sign-out button, where people look for it", async ({ page }) => {
    await signUp(page);
    await page.goto("/account");
    const button = page.getByRole("button", { name: "Sign out" });
    await expect(button).toBeVisible();
    await button.click();
    await expect(
      page.locator("header").getByRole("link", { name: "Sign in" })
    ).toBeVisible();
  });
});

test.describe("editing your own details", () => {
  test("saves a name, phone and address, and they survive a reload", async ({ page }) => {
    await signUp(page);
    await page.goto("/account");

    await page.getByLabel("Name").fill("Mario Rossi");
    await page.getByLabel("Phone").fill("+62 812 3456 7890");
    await page.getByLabel("Default delivery address").fill("Jl. Raya Canggu 1");
    await page.getByRole("button", { name: /save details/i }).click();
    await expect(page.getByText(/your details are saved/i)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Name")).toHaveValue("Mario Rossi");
    await expect(page.getByLabel("Phone")).toHaveValue("+62 812 3456 7890");
    await expect(page.getByLabel("Default delivery address"))
      .toHaveValue("Jl. Raya Canggu 1");
  });

  test("survives signing out and back in — it is on the account, not the device", async ({ page }) => {
    const email = uniqueEmail();
    await signUp(page, email);
    await page.goto("/account");
    await page.getByLabel("Phone").fill("+62 811 1111 1111");
    await page.getByRole("button", { name: /save details/i }).click();
    await expect(page.getByText(/your details are saved/i)).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(
      page.locator("header").getByRole("link", { name: "Sign in" })
    ).toBeVisible();

    await signIn(page, email);
    await page.goto("/account");
    await expect(page.getByLabel("Phone")).toHaveValue("+62 811 1111 1111");
  });

  test("offers a password change to a password account", async ({ page }) => {
    await signUp(page);
    await page.goto("/account");
    await expect(page.getByRole("button", { name: /change password/i })).toBeVisible();
  });
});

test.describe("navigation dead ends", () => {
  test("a signed-in visitor to /login is sent on, not shown the form again", async ({ page }) => {
    await signUp(page);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/plan/, { timeout: 15_000 });
  });

  test("a signed-in visitor to /signup is sent on too", async ({ page }) => {
    await signUp(page);
    await page.goto("/signup");
    await expect(page).toHaveURL(/\/plan/, { timeout: 15_000 });
  });

  test("but password reset still works while signed in", async ({ page }) => {
    await signUp(page);
    await page.goto("/reset");
    await expect(page.getByRole("button", { name: /send reset link/i })).toBeVisible();
  });
});

test.describe("guests", () => {
  test("can plan without an account and are offered a way in", async ({ page }) => {
    await page.goto("/plan");
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("are told to sign in for orders rather than shown an error", async ({ page }) => {
    await page.goto("/orders");
    await expect(page.getByText(/sign in to see your orders/i)).toBeVisible();
  });
});

test.describe("what a customer is shown about the deployment", () => {
  /**
   * Nothing here is a secret — the Firebase web config is public by design and
   * only variable NAMES were ever rendered. But environment variables, Secret
   * Manager and a deploy command are developer content, and a diner has no use
   * for them or for knowing how owner access is gated.
   */
  test("an ordinary account sees no deployment internals", async ({ page }) => {
    await signUp(page);
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: /account & access/i })).toBeVisible();

    const body = await page.locator("main").innerText();
    expect(body).not.toContain("ADMIN_EMAILS");
    expect(body).not.toContain("NEXT_PUBLIC_");
    expect(body).not.toContain("firebase deploy");
    expect(body).not.toContain("Secret Manager");
    expect(body).not.toMatch(/this deployment/i);
  });

  test("but still sees their own details and the way out", async ({ page }) => {
    await signUp(page);
    await page.goto("/account");
    await expect(page.getByLabel("Phone")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByText(/role on your token/i)).toBeVisible();
  });

  test("view-as is not offered to someone who is not an admin", async ({ page }) => {
    await signUp(page);
    await page.goto("/account");
    await expect(page.getByText(/^view as$/i)).toHaveCount(0);
  });
});
