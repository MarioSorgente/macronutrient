// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan, Dish } from "@/lib/storage/types";

const mocks = vi.hoisted(() => ({
  loadCurrentPlan: vi.fn(),
  savePlan: vi.fn(),
  listDishes: vi.fn(),
  houseRecipeLoader: vi.fn((_props: { enabled: boolean }) => null),
}));

vi.mock("@/lib/currentPlan", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/currentPlan")>(),
  loadCurrentPlan: mocks.loadCurrentPlan,
  savePlan: mocks.savePlan,
}));
// The real useRepos memoises on [uid, loading], so its identity is stable
// across renders. The stub must be stable too, or the planner's load effect
// re-fires on every render and the test measures the mock, not the component.
vi.mock("@/lib/storage/repos", () => {
  const repos = {
    plans: { save: vi.fn() },
    dishes: { list: mocks.listDishes, save: vi.fn() },
    houseRecipes: {},
    uid: null,
    loading: false,
  };
  return { useRepos: () => repos };
});
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

// Keep this focused on WeekPlanner's async boundary. The grid stub reads the
// same assignment snapshot the real grid uses when its dish map has no match.
vi.mock("@/components/PlanWeekGrid", () => ({
  default: ({ plan, onOpenMeal }: { plan: Plan; onOpenMeal: (assignment: Plan["assignments"][number]) => void }) => (
    <button data-testid="week" onClick={() => onOpenMeal(plan.assignments[0])}>
      {plan.assignments[0]?.snapshot.name}
    </button>
  ),
}));
vi.mock("@/components/MealDetailDialog", () => ({
  default: ({ onChangeServings }: { onChangeServings: (servings: number) => void }) => (
    <>
      <button onClick={() => onChangeServings(2)}>save two</button>
      <button onClick={() => onChangeServings(3)}>save three</button>
    </>
  ),
}));
vi.mock("@/components/MacroSummary", () => ({ default: () => null }));
vi.mock("@/components/TargetAdherence", () => ({ default: () => null }));
vi.mock("@/components/SegmentedToggle", () => ({ default: () => null }));

import WeekPlanner from "@/components/WeekPlanner";

describe("WeekPlanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listDishes.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opens the program week containing today in Bali", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-27T04:00:00.000Z"));
    mocks.loadCurrentPlan.mockResolvedValue({
      id: "plan-1", ownerUid: "", title: "August plan",
      createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
      targets: null, targetMode: "preset", mealSlots: ["Lunch"],
      programStartDate: "2026-08-17", weekCount: 4, status: "draft",
      submittedWeeks: [], assignments: [],
    } satisfies Plan);

    render(<WeekPlanner />);

    const weekTwo = await screen.findByRole("button", { name: "Week 2" });
    expect(weekTwo.className).toContain("bg-charcoal");
  });

  it("warns instead of silently moving a populated past plan and confirms an explicit move", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-27T04:00:00.000Z"));
    const populated = {
      id: "plan-1", ownerUid: "", title: "August plan",
      createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
      targets: null, targetMode: "preset", mealSlots: ["Lunch"],
      programStartDate: "2026-08-17", weekCount: 2, status: "draft", submittedWeeks: [],
      assignments: [{ id: "a1", week: 1, day: 6, slot: "Lunch", servings: 1,
        snapshot: { name: "Sunday meal", totals: { energy_kcal: 1, protein_g: 1, carbs_g: 1, fat_g: 1, fiber_g: 1 } } }],
    } satisfies Plan;
    mocks.loadCurrentPlan.mockResolvedValue(populated);
    mocks.savePlan.mockImplementation(async (_repo, _uid, plan: Plan) => plan);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<WeekPlanner />);
    expect(await screen.findByText("This plan starts in a past week.")).toBeTruthy();
    expect(mocks.savePlan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start from this week" }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("service dates will move"));
    expect(mocks.savePlan).toHaveBeenCalledWith(expect.anything(), null,
      expect.objectContaining({ programStartDate: "2026-08-24" }));
    expect(mocks.savePlan.mock.calls[0][2].assignments[0].day).toBe(6);
  });

  it("shows the week before the dish library request settles", async () => {
    let resolveDishes!: (dishes: Dish[]) => void;
    const pendingDishes = new Promise<Dish[]>((resolve) => {
      resolveDishes = resolve;
    });
    mocks.listDishes.mockReturnValue(pendingDishes);
    mocks.loadCurrentPlan.mockResolvedValue({
      id: "plan-1",
      ownerUid: "",
      title: "August plan",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      targets: null,
      targetMode: "preset",
      mealSlots: ["Lunch"],
      programStartDate: "2026-08-17",
      weekCount: 1,
      status: "draft",
      submittedWeeks: [],
      assignments: [
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
    } satisfies Plan);

    render(<WeekPlanner />);

    expect((await screen.findByTestId("week")).textContent).toContain(
      "Snapshot nasi campur"
    );
    expect(mocks.listDishes).toHaveBeenCalledOnce();
    expect(mocks.houseRecipeLoader.mock.calls.at(-1)?.[0]).toEqual({
      enabled: false,
    });

    resolveDishes([]);
  });

  it("keeps saving and unload protection active until every save settles", async () => {
    const plan = {
      id: "plan-1", ownerUid: "", title: "August plan",
      createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
      targets: null, targetMode: "preset", mealSlots: ["Lunch"],
      programStartDate: "2026-08-17", weekCount: 1, status: "draft",
      submittedWeeks: [],
      assignments: [{
        id: "assignment-1", week: 1, day: 0, slot: "Lunch", servings: 1,
        snapshot: { name: "Lunch", totals: { energy_kcal: 1, protein_g: 1, carbs_g: 1, fat_g: 1, fiber_g: 1 } },
      }],
    } satisfies Plan;
    mocks.loadCurrentPlan.mockResolvedValue(plan);

    let resolveFirst!: (plan: Plan) => void;
    let resolveSecond!: (plan: Plan) => void;
    mocks.savePlan
      .mockImplementationOnce(() => new Promise<Plan>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<Plan>((resolve) => { resolveSecond = resolve; }));

    render(<WeekPlanner />);
    fireEvent.click(await screen.findByTestId("week"));
    fireEvent.click(screen.getByText("save two"));
    fireEvent.click(screen.getByText("save three"));

    expect(screen.getByTestId("saving-indicator")).toBeTruthy();
    const whileBothPending = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(whileBothPending);
    expect(whileBothPending.defaultPrevented).toBe(true);

    await act(async () => resolveFirst(plan));

    expect(screen.getByTestId("saving-indicator")).toBeTruthy();
    const whileSecondPending = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(whileSecondPending);
    expect(whileSecondPending.defaultPrevented).toBe(true);

    await act(async () => resolveSecond(plan));
    expect(screen.queryByTestId("saving-indicator")).toBeNull();
  });
});
