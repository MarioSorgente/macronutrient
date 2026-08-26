/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MenuTab from "@/components/admin/MenuTab";
import { periodRange } from "@/lib/orderStats";
import type { Order, OrderDay, OrderMeal } from "@/lib/storage/types";

/** What sells, by servings and by the money actually charged for it. */

afterEach(cleanup);

const range = periodRange("90d");
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

function order(days: OrderDay[], over: Partial<Order> = {}): Order {
  return {
    id: "o1",
    createdAt: "",
    updatedAt: "",
    restaurantId: "negrita",
    userId: "u1",
    planId: "p1",
    weekNumber: 1,
    weekStartDate: "2026-08-24",
    status: "submitted",
    customer: { name: "Mario", email: "m@example.com" },
    days,
    totals: NO_MACROS,
    priceIdr: 50_000,
    mealCount: 1,
    payment: { status: "unpaid", method: "cash", amountIdr: 50_000 },
    submittedAt: "2026-08-20T00:00:00.000Z",
    lockedAt: "2026-08-22T10:00:00.000Z",
    statusHistory: [],
    ...over,
  };
}

const day = (meals: OrderMeal[], mode: "pickup" | "delivery" = "pickup"): OrderDay => ({
  date: "2026-08-24",
  fulfilment: { mode, time: "12:00" },
  meals,
});

describe("MenuTab", () => {
  it("ranks dishes by servings and shows what each earned", () => {
    render(
      <MenuTab
        orders={[
          order([
            day([
              meal({ name: "Beef bowl", servings: 3, priceIdr: 300_000 }),
              meal({ name: "Tofu bowl", servings: 1, priceIdr: 80_000 }),
            ]),
          ]),
        ]}
        range={range}
      />
    );

    const rows = [...document.querySelectorAll("tbody tr")].map(
      (tr) => tr.textContent ?? ""
    );
    expect(rows[0]).toContain("Beef bowl");
    expect(rows[0]).toContain("75%");
    expect(rows[0]).toContain("Rp 300.000");
    expect(rows[1]).toContain("Tofu bowl");

    expect(screen.getByText("Best seller")).toBeTruthy();
  });

  it("shows the slot and fulfilment splits", () => {
    render(
      <MenuTab
        orders={[
          order([
            day([meal({ slot: "Dinner", servings: 2 })], "delivery"),
            day([meal({ slot: "Lunch", servings: 1 })]),
          ]),
        ]}
        range={range}
      />
    );
    const slots = screen.getByText("Which slots").closest("div")!;
    expect(slots.textContent).toContain("Dinner");
    expect(slots.textContent).toContain("Lunch");

    const fulfilment = screen.getByText("Pickup or delivery").closest("div")!;
    // Two of the three servings are on the delivery day.
    expect(fulfilment.textContent).toContain("Delivery");
    expect(fulfilment.textContent).toContain("67%");
  });

  it("says so when the period holds nothing rather than showing an empty table", () => {
    render(<MenuTab orders={[]} range={range} />);
    expect(screen.getByText("Nothing ordered in this period")).toBeTruthy();
    expect(document.querySelector("tbody")).toBeNull();
  });
});
