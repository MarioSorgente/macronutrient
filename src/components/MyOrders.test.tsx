/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/lib/storage/types";

const mocks = vi.hoisted(() => ({ listMyOrders: vi.fn() }));

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { uid: "customer-1" }, loading: false }),
}));
vi.mock("@/lib/storage/orders", () => ({ listMyOrders: mocks.listMyOrders }));

import MyOrders from "@/components/MyOrders";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.listMyOrders.mockReset();
});

describe("MyOrders", () => {
  it("explains an index failure and loads the orders when retried", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const loaded = {
      id: "order-1",
      weekStartDate: "2026-08-31",
      submittedAt: "2026-08-28",
      status: "submitted",
      mealCount: 1,
      days: [{}],
      priceIdr: 100_000,
      totals: { energy_kcal: 500, protein_g: 30, carbs_g: 50, fat_g: 15, fiber_g: 5 },
    } as Order;
    mocks.listMyOrders
      .mockRejectedValueOnce({ code: "failed-precondition" })
      .mockResolvedValueOnce([loaded]);

    render(<MyOrders />);

    expect(await screen.findByText("Orders are temporarily unavailable. Retry in a moment."))
      .toBeTruthy();
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("required Firestore composite index may be missing"),
      expect.objectContaining({ code: "failed-precondition" })
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(mocks.listMyOrders).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Week of/)).toBeTruthy();
    expect(screen.queryByText("Orders are temporarily unavailable. Retry in a moment.")).toBeNull();
  });
});
