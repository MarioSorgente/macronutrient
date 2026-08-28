/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Order, OrderDay, OrderMeal } from "@/lib/storage/types";

/**
 * The kitchen could not open an order at all.
 *
 * The order book listed cards that linked nowhere, accepting one changed a
 * badge and nothing else, and the route policy limits the customer's own
 * `/orders/[id]` to the `client` role — so there was no screen anywhere that
 * told a cook who the order was for, which day each meal was due, by what time,
 * whether it was collected or delivered, or what was actually in it.
 *
 * Every assertion here is one of those questions.
 */

const NO_MACROS = {
  energy_kcal: 520, protein_g: 40, carbs_g: 45, fat_g: 18, fiber_g: 4,
};

const meal = (over: Partial<OrderMeal> = {}): OrderMeal => ({
  assignmentId: "a1",
  slot: "Lunch",
  name: "Geisha",
  servings: 1,
  items: [
    { ingredientId: "chicken_breast_raw", name: "Chicken", grams: 200, unitId: "g", quantity: 200 },
    { ingredientId: "rice_jasmine_cooked_proxy", name: "Rice", grams: 150, unitId: "g", quantity: 150 },
  ],
  totals: NO_MACROS,
  priceIdr: 89_000,
  ...over,
});

const day = (over: Partial<OrderDay> = {}): OrderDay => ({
  date: "2026-08-24",
  fulfilment: { mode: "pickup", time: "12:30" },
  meals: [meal()],
  ...over,
});

function order(over: Partial<Order> = {}): Order {
  return {
    id: "o1", createdAt: "", updatedAt: "",
    restaurantId: "negrita", userId: "u1", planId: "p1",
    weekNumber: 1, weekStartDate: "2026-08-24",
    status: "submitted",
    customer: { name: "Giulia", email: "giulia@example.com", phone: "+62811234" },
    days: [day()],
    totals: NO_MACROS,
    priceIdr: 89_000,
    mealCount: 1,
    payment: { status: "unpaid", method: "cash", amountIdr: 89_000 },
    submittedAt: "2026-08-20T02:00:00.000Z",
    lockedAt: "2026-08-22T10:00:00.000Z",
    statusHistory: [],
    ...over,
  };
}

const mocks = vi.hoisted(() => ({
  order: null as unknown,
  setOrderStatus: vi.fn(() => Promise.resolve()),
  role: "restaurant" as string,
}));

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "o1" }) }));
vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { uid: "staff1" }, role: mocks.role }),
}));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("@/lib/storage/orders", () => ({
  getOrder: () => Promise.resolve(mocks.order),
  listOrderPrepTasks: () => Promise.resolve([]),
  setOrderStatus: mocks.setOrderStatus,
}));

import KitchenOrderDetail from "@/components/KitchenOrderDetail";

afterEach(cleanup);

async function show(value: Order | null, role = "restaurant") {
  mocks.order = value;
  mocks.role = role;
  render(<KitchenOrderDetail />);
  await waitFor(() =>
    expect(screen.queryByText("Loading the order…")).toBeNull()
  );
}

describe("who the order is for", () => {
  it("names the customer and offers a way to reach them", async () => {
    await show(order());
    expect(screen.getByText("Giulia")).toBeTruthy();
    const email = screen.getByText("giulia@example.com").closest("a")!;
    expect(email.getAttribute("href")).toBe("mailto:giulia@example.com");
    expect(screen.getByText("+62811234").closest("a")!.getAttribute("href"))
      .toBe("tel:+62811234");
  });

  it("offers the customer record to an owner only", async () => {
    await show(order(), "admin");
    expect(screen.getByText("Customer record").closest("a")!.getAttribute("href"))
      .toBe("/admin/customers/u1");
    cleanup();
    await show(order(), "restaurant");
    expect(screen.queryByText("Customer record")).toBeNull();
  });
});

describe("when it is due, and what has happened to it", () => {
  it("shows each service day with its time and how the food leaves", async () => {
    await show(order({
      days: [
        day({ date: "2026-08-24", fulfilment: { mode: "pickup", time: "12:30" } }),
        day({
          date: "2026-08-25",
          fulfilment: { mode: "delivery", time: "18:00", address: "Villa Rosa, Canggu" },
        }),
      ],
    }));
    // Scoped to the day headings: the week-of label carries the same date.
    const headings = [...document.querySelectorAll("h3")].map((h) => h.textContent);
    expect(headings.some((text) => /Aug 24/.test(text ?? ""))).toBe(true);
    expect(screen.getByText("12:30")).toBeTruthy();
    expect(screen.getByText(/Pickup by/)).toBeTruthy();
    expect(screen.getByText(/Deliver by/)).toBeTruthy();
    expect(screen.getByText("18:00")).toBeTruthy();
    // Without the address a delivery cannot actually be delivered.
    expect(screen.getByText("Villa Rosa, Canggu")).toBeTruthy();
  });

  it("puts the days in the order they are cooked", async () => {
    await show(order({ days: [day({ date: "2026-08-26" }), day({ date: "2026-08-24" })] }));
    const headings = [...document.querySelectorAll("h3")].map((h) => h.textContent);
    expect(headings[0]).toMatch(/Aug 24/);
    expect(headings[1]).toMatch(/Aug 26/);
  });

  it("renders the status history, which nothing else in the app shows", async () => {
    await show(order({
      status: "accepted",
      statusHistory: [{ status: "accepted", at: "2026-08-21T03:00:00.000Z", byUid: "staff1" }],
    }));
    const progress = screen.getByText("Progress").closest("div")!;
    expect(progress.textContent).toContain("Sent by the customer");
    expect(progress.textContent).toContain("Accepted");
  });
});

describe("what to prepare", () => {
  it("lists the meal with its slot and servings", async () => {
    await show(order({ days: [day({ meals: [meal({ servings: 2 })] })] }));
    expect(screen.getByText("Geisha")).toBeTruthy();
    expect(screen.getByText("Lunch")).toBeTruthy();
    expect(screen.getByText("×2")).toBeTruthy();
  });

  it("keeps the ingredients collapsed until asked for", async () => {
    await show(order());
    const disclosure = screen.getByText("Geisha").closest("details")!;
    expect(disclosure.open).toBe(false);
    expect(screen.getByText(/2 ingredients/)).toBeTruthy();
  });

  it("scales ingredient grams by servings, like the prep board", async () => {
    // 200 g of chicken for one serving is 400 g for two. Getting this wrong
    // means cooking half the order.
    await show(order({ days: [day({ meals: [meal({ servings: 2 })] })] }));
    fireEvent.click(screen.getByText("Geisha").closest("summary")!);
    const disclosure = screen.getByText("Geisha").closest("details")!;
    expect(disclosure.textContent).toContain("400 g");
    expect(disclosure.textContent).toContain("300 g");
  });

  it("totals every ingredient across the whole order", async () => {
    await show(order({
      days: [day({ date: "2026-08-24" }), day({ date: "2026-08-25" })],
    }));
    const rollup = screen.getByText("Everything in this order").closest("div")!;
    // Two days of the same meal: 200 g of chicken becomes 400 g.
    expect(rollup.textContent).toContain("400 g");
  });

  it("links each day to its prep board", async () => {
    await show(order());
    expect(
      screen.getByText("Prep board for this day").closest("a")!.getAttribute("href")
    ).toBe("/kitchen/2026-08-24");
  });
});

describe("moving the order along", () => {
  it("offers the staff transitions for a submitted order", async () => {
    await show(order({ status: "submitted" }));
    expect(screen.getByRole("button", { name: "Accepted" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rejected" })).toBeTruthy();
  });

  it("offers nothing once the order is collected", async () => {
    await show(order({ status: "completed" }));
    expect(screen.queryByRole("button", { name: "Accepted" })).toBeNull();
  });

  it("says so when the transition fails rather than looking accepted", async () => {
    // Failing silently would leave someone cooking an order they rejected.
    mocks.setOrderStatus.mockRejectedValueOnce(
      Object.assign(new Error("Network is down"), { name: "ApiError" })
    );
    await show(order({ status: "submitted" }));
    fireEvent.click(screen.getByRole("button", { name: "Accepted" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Network is down")
    );
  });
});

describe("an order that is not there", () => {
  it("says so and offers the way back", async () => {
    await show(null);
    expect(screen.getByText("Order not found")).toBeTruthy();
    expect(screen.getByText("Back to orders").closest("a")!.getAttribute("href"))
      .toBe("/kitchen/orders");
  });
});
