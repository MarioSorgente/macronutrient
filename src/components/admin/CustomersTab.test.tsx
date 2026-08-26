/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CustomersTab from "@/components/admin/CustomersTab";
import { periodRange } from "@/lib/orderStats";
import type { CustomerRow } from "@/lib/admin/analytics";

/**
 * The customers tab exists to surface the person who quietly stopped ordering,
 * which a table sorted by lifetime spend hides completely.
 */

afterEach(cleanup);

const range = periodRange("90d");

function row(over: Partial<CustomerRow> = {}): CustomerRow {
  return {
    uid: "u1",
    name: "Mario",
    email: "m@example.com",
    joined: "2026-08-01T00:00:00.000Z",
    lastLoginAt: undefined,
    logins: 3,
    orders: 2,
    meals: 12,
    spendIdr: 300_000,
    lifetimeIdr: 300_000,
    avgOrderIdr: 150_000,
    lastOrderWeek: "2026-08-24",
    segment: "active",
    ...over,
  };
}

describe("CustomersTab", () => {
  it("shows the segment split and the customer table", () => {
    render(<CustomersTab rows={[row()]} range={range} />);
    expect(screen.getByText("Where everyone stands")).toBeTruthy();
    expect(screen.getByText("Customers")).toBeTruthy();
    // Period spend and the lifetime figure are both offered, and labelled.
    expect(screen.getByText("Spend")).toBeTruthy();
    expect(screen.getByText("Lifetime")).toBeTruthy();
    expect(screen.getByText("Avg order")).toBeTruthy();
  });

  it("calls out lapsed customers, highest spender first", () => {
    render(
      <CustomersTab
        rows={[
          row({ uid: "small", name: "Small", segment: "lapsed", lifetimeIdr: 10_000 }),
          row({ uid: "big", name: "Big", segment: "lapsed", lifetimeIdr: 900_000 }),
          row({ uid: "ok", name: "Ok", segment: "active" }),
        ]}
        range={range}
      />
    );
    const callout = screen.getByText("Worth a message").closest("div")!;
    expect(callout.textContent).toContain("2 customers have ordered before");
    const names = [...callout.querySelectorAll("li")].map((li) =>
      li.textContent?.split("last ordered")[0]
    );
    expect(names).toEqual(["Big", "Small"]);
  });

  it("hides the callout when nobody has drifted away", () => {
    render(<CustomersTab rows={[row({ segment: "active" })]} range={range} />);
    expect(screen.queryByText("Worth a message")).toBeNull();
  });

  it("still lists someone who signed up and never ordered", () => {
    // That gap is exactly what the owner wants to see.
    render(
      <CustomersTab
        rows={[row({ name: "Ghost", segment: "never", lastOrderWeek: undefined })]}
        range={range}
      />
    );
    expect(screen.getByText("Ghost")).toBeTruthy();
    expect(screen.getByText("never")).toBeTruthy();
  });
});
