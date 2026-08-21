// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Client, Dish } from "@/lib/storage/types";

const mocks = vi.hoisted(() => ({
  loadCurrentPlan: vi.fn(),
  listDishes: vi.fn(),
  houseRecipeLoader: vi.fn(() => null),
}));

vi.mock("@/lib/currentPlan", () => ({ loadCurrentPlan: mocks.loadCurrentPlan }));
vi.mock("@/lib/storage", () => ({
  getClientRepository: () => ({ save: vi.fn() }),
  getDishRepository: () => ({ list: mocks.listDishes, save: vi.fn() }),
}));
vi.mock("@/lib/planView", () => ({
  usePlanView: () => ["week", vi.fn()],
  useShowPrices: () => [false, vi.fn()],
}));
vi.mock("@/store/houseRecipes", () => ({
  useHouseRecipes: (selector: (state: { version: number }) => number) =>
    selector({ version: 0 }),
}));
vi.mock("@/components/HouseRecipeLoader", () => ({
  default: mocks.houseRecipeLoader,
}));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

// Keep this focused on ClientPlanner's async boundary. The grid stub reads the
// same assignment snapshot the real grid uses when its dish map has no match.
vi.mock("@/components/PlanWeekGrid", () => ({
  default: ({ client }: { client: Client }) => (
    <div data-testid="week">{client.plan[0]?.snapshot.name}</div>
  ),
}));
vi.mock("@/components/MacroSummary", () => ({ default: () => null }));
vi.mock("@/components/TargetAdherence", () => ({ default: () => null }));
vi.mock("@/components/SegmentedToggle", () => ({ default: () => null }));

import ClientPlanner from "@/components/ClientPlanner";

describe("ClientPlanner", () => {
  it("shows the week before the dish library request settles", async () => {
    let resolveDishes!: (dishes: Dish[]) => void;
    const pendingDishes = new Promise<Dish[]>((resolve) => {
      resolveDishes = resolve;
    });
    mocks.listDishes.mockReturnValue(pendingDishes);
    mocks.loadCurrentPlan.mockResolvedValue({
      id: "plan-1",
      name: "August plan",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      targets: null,
      mealSlots: ["Lunch"],
      programStartDate: "2026-08-17",
      weekCount: 1,
      plan: [
        {
          id: "assignment-1",
          week: 1,
          day: 0,
          slot: "Lunch",
          dishId: "dish-still-loading",
          servings: 1,
          snapshot: {
            name: "Snapshot nasi campur",
            totals: {
              energy_kcal: 650,
              protein_g: 35,
              carbs_g: 70,
              fat_g: 20,
              fiber_g: 8,
            },
          },
        },
      ],
    } satisfies Client);

    render(<ClientPlanner />);

    expect((await screen.findByTestId("week")).textContent).toContain(
      "Snapshot nasi campur"
    );
    expect(mocks.listDishes).toHaveBeenCalledOnce();
    expect(mocks.houseRecipeLoader.mock.calls.at(-1)?.[0]).toEqual({
      enabled: false,
    });

    resolveDishes([]);
  });
});
