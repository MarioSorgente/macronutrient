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

// --- Emulator access, for asserting what actually reached the database -------
//
// Node's built-in fetch does not read HTTPS_PROXY, so these reach loopback
// directly. `Bearer owner` tells the Firestore emulator to bypass rules, the
// way the Admin SDK does in production.

const FIRESTORE = "http://127.0.0.1:8080/v1/projects/demo-mamma/databases/(default)/documents";
const ADMIN = { authorization: "Bearer owner" } as const;

function decodeValue(value: Record<string, unknown>): unknown {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) {
    const arr = value.arrayValue as { values?: Record<string, unknown>[] };
    return (arr.values ?? []).map(decodeValue);
  }
  if ("mapValue" in value) {
    const map = value.mapValue as { fields?: Record<string, Record<string, unknown>> };
    return Object.fromEntries(
      Object.entries(map.fields ?? {}).map(([k, v]) => [k, decodeValue(v)])
    );
  }
  return undefined;
}

function decode(doc: { fields?: Record<string, Record<string, unknown>> }) {
  return Object.fromEntries(
    Object.entries(doc.fields ?? {}).map(([k, v]) => [k, decodeValue(v)])
  );
}

/** Every document in a collection, past the security rules. */
export async function dbList(path: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${FIRESTORE}/${path}?pageSize=300`, { headers: ADMIN });
  if (!res.ok) throw new Error(`dbList ${path}: ${res.status}`);
  const body = (await res.json()) as { documents?: { fields?: Record<string, Record<string, unknown>> }[] };
  return (body.documents ?? []).map(decode);
}

/** One document, past the security rules; null when it does not exist. */
export async function dbGet(path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${FIRESTORE}/${path}`, { headers: ADMIN });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`dbGet ${path}: ${res.status}`);
  return decode(await res.json());
}

/**
 * Polls until `check` returns something truthy, or fails loudly.
 *
 * `describe` is included in the failure so a timeout says what the database
 * actually held, rather than only that it was not what we wanted.
 */
export async function until<T>(
  check: () => Promise<T | null | undefined | false>,
  label: string,
  { timeoutMs = 30_000, describe }: { timeoutMs?: number; describe?: () => Promise<unknown> } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value as T;
    await new Promise((r) => setTimeout(r, 300));
  }
  let seen = "";
  if (describe) {
    seen = ` Last seen: ${JSON.stringify(await describe().catch((e) => String(e))).slice(0, 1200)}`;
  }
  throw new Error(`Timed out waiting for ${label}.${seen}`);
}

/** A Monday `weeks` weeks from the current one, as yyyy-mm-dd. */
export function mondayAhead(weeks: number): string {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dow = (new Date(midnight).getUTCDay() + 6) % 7; // 0 = Monday
  return new Date(midnight - dow * 86_400_000 + weeks * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

const AUTH_EMULATOR = "http://127.0.0.1:9099";

/** The address on the emulator's ADMIN_EMAILS allowlist (functions/.secret.example). */
export const OWNER_EMAIL = "owner@example.com";

/** Marks an address confirmed, the way clicking the emailed link would. */
export async function verifyEmail(email: string): Promise<void> {
  const lookup = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:lookup`,
    {
      method: "POST",
      headers: { authorization: "Bearer owner", "content-type": "application/json" },
      body: JSON.stringify({ email: [email] }),
    }
  );
  const { users } = (await lookup.json()) as { users?: { localId: string }[] };
  const uid = users?.[0]?.localId;
  if (!uid) throw new Error(`verifyEmail: no account for ${email}`);

  const res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:update`,
    {
      method: "POST",
      headers: { authorization: "Bearer owner", "content-type": "application/json" },
      body: JSON.stringify({ localId: uid, emailVerified: true }),
    }
  );
  if (!res.ok) throw new Error(`verifyEmail failed: ${res.status}`);
}

/**
 * Deletes every emulator account.
 *
 * The owner tests need the allowlisted address to be fresh each time, and that
 * address is fixed by the allowlist rather than generated. Specs run serially
 * (workers: 1), so this only ever clears accounts the current spec made.
 */
export async function clearAuthAccounts(): Promise<void> {
  const res = await fetch(
    `${AUTH_EMULATOR}/emulator/v1/projects/demo-mamma/accounts`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error(`clearAuthAccounts failed: ${res.status}`);
}
