import type { Page } from "@playwright/test";

/** Unique address per test, so the emulator's account list never collides. */
export function uniqueEmail(prefix = "diner"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.com`;
}

export const PASSWORD = "password123";

/** Creates an account through the real sign-up form and lands on /plan. */
export async function signUp(page: Page, email = uniqueEmail(), name = "Test Diner") {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/plan**", { timeout: 30_000 });
  return email;
}

export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 30_000,
  });
}

/**
 * Whether the element is genuinely clickable where it appears, rather than
 * merely laid out there.
 *
 * `isVisible()` and `boundingBox()` both ignore ancestor overflow clipping —
 * which is exactly the failure that hid Sign out inside the scrolling nav — so
 * this hit-tests the centre point the way a finger would.
 */
export async function isHitTestable(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) {
      return false;
    }
    const hit = document.elementFromPoint(cx, cy);
    return !!hit && (hit === el || el.contains(hit));
  });
}

/** True when the element sits fully inside the viewport with no scrolling. */
export async function isOnScreen(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.right <= window.innerWidth && r.width > 0;
  });
}
