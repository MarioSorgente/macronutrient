/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrepTask } from "@/lib/storage/types";

/**
 * Whether the board admits it has stopped updating.
 *
 * A live listener needs an index and permissions, so the board falls back to a
 * one-shot read when it cannot open one — right, because a missing index should
 * degrade to a static board rather than a blank one. But it said nothing. The
 * board rendered normally, looked exactly like a live one, and then never
 * changed again, so two cooks working the same pass drifted apart with no sign
 * that anything was wrong. Silence is worse than an error here: nobody goes
 * looking for a failure they have no reason to suspect.
 */

const mocks = vi.hoisted(() => ({
  watchPrepTasks: vi.fn(),
  listPrepTasks: vi.fn(),
  listAllOrders: vi.fn(),
}));

vi.mock("@/lib/auth/AuthProvider", () => ({ useAuth: () => ({ user: { uid: "cook" } }) }));
vi.mock("@/lib/storage/orders", () => ({
  watchPrepTasks: mocks.watchPrepTasks,
  listPrepTasks: mocks.listPrepTasks,
  listAllOrders: mocks.listAllOrders,
  setPrepStatus: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

import KitchenBoard from "@/components/KitchenBoard";

const task = (): PrepTask =>
  ({
    id: "t1", createdAt: "", updatedAt: "", restaurantId: "negrita",
    orderId: "o1", userId: "u1", date: "2026-08-24", slot: "Lunch",
    readyBy: "12:00", mode: "pickup", customerName: "Mario",
    mealName: "Nasi", servings: 1, items: [],
    totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    status: "todo",
  }) as PrepTask;

describe("a prep board that cannot listen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAllOrders.mockResolvedValue([]);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("says nothing extra while the listener is working", async () => {
    mocks.watchPrepTasks.mockImplementation(async (_day: string, onNext: (t: PrepTask[]) => void) => {
      onNext([task()]);
      return () => {};
    });

    render(<KitchenBoard date="2026-08-24" />);

    await screen.findByText("Nasi");
    expect(screen.queryByText(/not updating live/i)).toBeNull();
  });

  it("shows the work and says it is not live when it falls back to a read", async () => {
    mocks.watchPrepTasks.mockRejectedValue(new Error("missing index"));
    mocks.listPrepTasks.mockResolvedValue([task()]);

    render(<KitchenBoard date="2026-08-24" />);

    // The work is still there — degrading to static beats going blank.
    await screen.findByText("Nasi");
    // And the kitchen is told, rather than left to notice the board never moves.
    await waitFor(() =>
      expect(screen.getByText(/not updating live/i)).toBeTruthy()
    );
  });
});
