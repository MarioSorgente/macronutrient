/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, baliWeekStart } from "@/lib/format";
import type { Order, OrderDay, OrderMeal } from "@/lib/storage/types";

/**
 * The staff order book.
 *
 * The load-bearing assertion here is the last one: the summary tiles must stay
 * counts. Staff see the price on an order because they hand the food over, but
 * aggregate revenue is the owner's screen, and the split between
 * `lib/orderStats` and `lib/admin/analytics` is what keeps it that way.
 */

const NO_MACROS = {
  energy_kcal: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  fiber_g: 0,
};

function meal(over: Partial<OrderMeal> = {}): OrderMeal {
  return {
    assignmentId: "a1",
    slot: "Lunch",
    name: "Chicken bowl",
    servings: 1,
    items: [],
    totals: NO_MACROS,
    priceIdr: 50_000,
    ...over,
  };
}

function day(meals: OrderMeal[], mode: "pickup" | "delivery" = "pickup"): OrderDay {
  return { date: baliWeekStart(), fulfilment: { mode, time: "12:00" }, meals };
}

function order(over: Partial<Order> = {}): Order {
  return {
    id: "o1",
    createdAt: "",
    updatedAt: "",
    restaurantId: "negrita",
    userId: "u1",
    planId: "p1",
    weekNumber: 1,
    weekStartDate: baliWeekStart(),
    status: "submitted",
    customer: { name: "Mario", email: "m@example.com" },
    days: [day([meal()])],
    totals: NO_MACROS,
    priceIdr: 250_000,
    mealCount: 1,
    payment: { status: "unpaid", method: "cash", amountIdr: 250_000 },
    submittedAt: "2026-08-20T00:00:00.000Z",
    lockedAt: "2026-08-22T10:00:00.000Z",
    statusHistory: [],
    ...over,
  };
}

const mocks = vi.hoisted(() => ({ orders: [] as unknown[] }));

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { uid: "staff1" }, role: "restaurant" }),
}));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("@/lib/storage/orders", () => ({
  listAllOrders: () => Promise.resolve(mocks.orders),
  setOrderStatus: vi.fn(() => Promise.resolve()),
  // The screen subscribes rather than polling, so the double stands in for a
  // listener: it delivers once and hands back an unsubscribe.
  watchAllOrders: (onChange: (orders: unknown[]) => void) => {
    onChange(mocks.orders as unknown[]);
    return Promise.resolve(() => {});
  },
}));

import KitchenOrders from "@/components/KitchenOrders";

afterEach(cleanup);

async function show(orders: Order[]) {
  mocks.orders = orders;
  render(<KitchenOrders />);
  await waitFor(() => expect(screen.getByText("Needs a decision")).toBeTruthy());
}

describe("KitchenOrders", () => {
  it("counts the queue the kitchen has to act on", async () => {
    await show([
      order({ id: "a", status: "submitted" }),
      order({ id: "b", status: "submitted" }),
      order({ id: "c", status: "in_prep" }),
      order({ id: "d", status: "ready" }),
    ]);

    const tile = (label: string) =>
      screen.getByText(label).parentElement?.parentElement?.textContent ?? "";
    expect(tile("Needs a decision")).toContain("2");
    expect(tile("Ready to collect")).toContain("1");
  });

  it("groups orders by service week with a per-week subtotal", async () => {
    await show([
      order({
        id: "a",
        days: [day([meal({ servings: 2 })]), day([meal({ servings: 3 })], "delivery")],
      }),
    ]);
    const heading = screen.getByText(/^Week of /).closest("h2")!;
    expect(heading.textContent).toContain("1 order");
    expect(heading.textContent).toContain("5 meals");
    expect(heading.textContent).toContain("2 pickup / 3 delivery");
  });

  it("keeps the price on each order card", async () => {
    await show([order()]);
    expect(screen.getByText("Rp 250.000")).toBeTruthy();
  });

  it("puts no money total in the summary tiles", async () => {
    // The regression test for the staff/owner boundary.
    await show([order({ priceIdr: 250_000 })]);
    const strip = screen.getByText("Needs a decision").closest(".grid")!;
    expect(strip.textContent).not.toContain("Rp");
  });

  it("keeps upcoming weeks out of what sold lately", async () => {
    // "Popular lately" is history; the Load ahead chart covers the future.
    await show([
      order({
        id: "past",
        weekStartDate: addDays(baliWeekStart(), -7),
        days: [day([meal({ name: "Sold before" })])],
      }),
      order({
        id: "future",
        weekStartDate: addDays(baliWeekStart(), 7),
        days: [day([meal({ name: "Not cooked yet" })])],
      }),
    ]);
    const card = screen.getByText("Popular lately").closest("div")!;
    expect(card.textContent).toContain("Sold before");
    expect(card.textContent).not.toContain("Not cooked yet");
  });

  it("opens the order, which staff had no way to reach at all", async () => {
    await show([order({ id: "abc" })]);
    const link = screen.getByText("Mario").closest("a")!;
    expect(link.getAttribute("href")).toBe("/kitchen/orders/abc");
    expect(screen.getByText("See what to prepare")).toBeTruthy();
  });

  it("keeps the status buttons out of the link", async () => {
    // Accepting from the list must not navigate away from it.
    await show([order({ status: "submitted" })]);
    const accept = screen.getByRole("button", { name: "Accepted" });
    expect(accept.closest("a")).toBeNull();
  });

  it("filters by customer name", async () => {
    await show([
      order({ id: "a", customer: { name: "Mario", email: "m@example.com" } }),
      order({ id: "b", customer: { name: "Giulia", email: "g@example.com" } }),
    ]);
    expect(screen.getByLabelText("Search orders by customer")).toBeTruthy();
    expect(screen.getByText("Giulia")).toBeTruthy();
  });
});
