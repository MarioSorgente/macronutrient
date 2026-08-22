import { test, expect, type Page } from "@playwright/test";
import { dbGet, dbList, mondayAhead, signUp, until } from "./helpers";

/**
 * The money path, end to end through the real UI and a real database:
 * plan a week as a guest → sign up → the guest's work is claimed into the
 * account → send it to the kitchen → the order and its prep tasks exist →
 * cancel → the kitchen's board is cleared and the week is free again.
 *
 * This is the last item on the README's own go-live checklist ("submit one
 * real week end to end and check it reaches /kitchen"), which nothing
 * automated had ever covered.
 */

const RID = "negrita";

test.describe.configure({ mode: "serial" });

/**
 * Desktop only. The planner opens in Day view on a phone, so the seven-column
 * grid this drives ("Add to Lunch on Mon") is not rendered there at all. The
 * phone viewport is covered by the user-action matrix instead.
 */
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile",
    "drives the week grid, which is desktop-only"
  );
});

/**
 * Moves the plan's start date forward.
 *
 * A brand-new plan starts on THIS week's Monday, whose cutoff (the preceding
 * Sunday at 18:00 Bali) is already in the past — so week 1 of a fresh plan can
 * never be ordered. Picking a future start is what a real person does, and it
 * makes the test independent of what day it runs on.
 */
async function startPlanInTheFuture(page: Page) {
  await page.goto("/plan");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Program starts").fill(mondayAhead(2));
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByLabel("Program starts")).toBeHidden();
}

/**
 * Builds one meal into a slot from real ingredients.
 *
 * Everything after opening is scoped to the dialog: the planner grid behind it
 * has its own "Add to Lunch on Mon" buttons and its own meal buttons carrying
 * ingredient names, and Playwright's `name` matching is a substring by default.
 */
async function addMeal(page: Page, day: string, slot: string, ingredient: string) {
  await page.getByRole("button", { name: `Add to ${slot} on ${day}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Build", exact: true }).click();
  await dialog.getByLabel("Search an ingredient to add…").fill(ingredient);
  await dialog.getByRole("button", { name: new RegExp(ingredient, "i") }).first().click();
  await dialog.getByRole("button", { name: `Add to ${slot}`, exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("a guest plans a week, signs up, sends it to the kitchen, then cancels", async ({ page }) => {
  // --- as a guest, on this device only ------------------------------------
  await startPlanInTheFuture(page);
  await addMeal(page, "Mon", "Lunch", "Chicken breast");
  await addMeal(page, "Tue", "Lunch", "Chicken breast");

  // Wait for the device store itself, not for a timeout: the planner persists
  // asynchronously, and navigating to sign-up before the second write lands
  // would leave a meal behind with nothing to claim.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const raw = localStorage.getItem("mamma-calories:clients");
          const parsed = raw ? JSON.parse(raw) : [];
          return Array.isArray(parsed)
            ? (parsed[0]?.assignments?.length ?? 0)
            : 0;
        }),
      { message: "both meals saved to the guest store", timeout: 15_000 }
    )
    .toBe(2);

  // --- signing up claims that work into the account ------------------------
  await signUp(page);

  const plan = await until(
    async () => {
      const users = await dbList("users");
      for (const u of users) {
        const found = await dbGet(`users/${u.uid}/plans/primary`);
        if (found && Array.isArray(found.assignments) && found.assignments.length >= 2) {
          return { uid: String(u.uid), plan: found };
        }
      }
      return null;
    },
    "the guest's week to be claimed into the account",
    {
      describe: async () => {
        const users = await dbList("users");
        return Promise.all(
          users.map(async (u) => ({
            uid: u.uid,
            plans: (await dbList(`users/${u.uid}/plans`)).map((pl) => ({
              id: pl.id,
              assignments: Array.isArray(pl.assignments) ? pl.assignments.length : pl.assignments,
              updatedAt: pl.updatedAt,
            })),
          }))
        );
      },
    }
  );

  expect(plan.plan.assignments).toHaveLength(2);
  expect(plan.plan.programStartDate).toBe(mondayAhead(2));

  // --- send it to the kitchen ---------------------------------------------
  await page.goto("/plan/submit");
  // Week 1 of this plan starts two weeks out, so its cutoff is still open.
  const send = page.getByRole("button", { name: /send week \d+ to the kitchen/i });
  await expect(send).toBeEnabled({ timeout: 20_000 });
  await send.click();

  // --- the database is what proves it ---------------------------------------
  const order = await until(
    async () => (await dbList(`restaurants/${RID}/orders`))[0],
    "the order to be written by submitOrder"
  );
  expect(order.userId).toBe(plan.uid);
  expect(order.status).toBe("submitted");
  expect(order.mealCount).toBe(2);
  // Two 150 g chicken portions at Rp 30,000, priced by the server itself.
  expect(order.priceIdr).toBe(60_000);

  const tasks = await until(
    async () => {
      const found = await dbList(`restaurants/${RID}/prepTasks`);
      return found.length === 2 ? found : null;
    },
    "one prep task per meal"
  );
  expect(tasks.every((t) => t.orderId === order.id)).toBe(true);
  expect(tasks.every((t) => t.status === "todo")).toBe(true);

  // The plan records the week as sent, so it cannot be sent twice.
  await until(
    async () => {
      const after = await dbGet(`users/${plan.uid}/plans/primary`);
      return Array.isArray(after?.submittedWeeks) && after.submittedWeeks.length === 1;
    },
    "the week to be marked submitted on the plan"
  );

  // --- the customer sees their receipt --------------------------------------
  await page.goto("/orders");
  await expect(page.getByText(/2 meals/i)).toBeVisible();
  await page.getByRole("link").filter({ hasText: /week of/i }).first().click();
  await expect(page.getByText(/Rp 60\.000/)).toBeVisible();

  // --- and can cancel it, which must clear the kitchen's work ---------------
  await page.getByRole("button", { name: /cancel this week/i }).click();
  await page.getByRole("button", { name: /yes, cancel it/i }).click();

  await until(
    async () => (await dbList(`restaurants/${RID}/prepTasks`)).length === 0,
    "the cancelled order's prep tasks to be cleared by onOrderStatusChanged"
  );
  await until(
    async () => {
      const after = await dbGet(`users/${plan.uid}/plans/primary`);
      return Array.isArray(after?.submittedWeeks) && after.submittedWeeks.length === 0;
    },
    "the week to be freed so it can be fixed and resent"
  );
});
