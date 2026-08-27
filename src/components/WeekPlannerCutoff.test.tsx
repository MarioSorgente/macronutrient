// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RESTAURANT_CONFIG, type Plan, type RestaurantConfig } from "@/lib/storage/types";

/**
 * The ordering deadline, while there is still time to act on it.
 *
 * It used to live only on the submit screen — the last step, after a week had
 * already been planned. A kitchen that had stopped taking orders was worse
 * still: it greyed out the send button and said nothing at all, so the first
 * sign of it was a control that did not work.
 */

const mocks = vi.hoisted(() => ({
  loadCurrentPlan: vi.fn(),
  savePlan: vi.fn(),
  listDishes: vi.fn(),
  config: null as RestaurantConfig | null,
}));

vi.mock("@/lib/currentPlan", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/currentPlan")>(),
  loadCurrentPlan: mocks.loadCurrentPlan,
  savePlan: mocks.savePlan,
}));
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
vi.mock("@/lib/storage/orders", () => ({
  loadRestaurantConfig: () => Promise.resolve(mocks.config),
}));
vi.mock("@/lib/planView", () => ({
  usePlanView: () => ["week", vi.fn()],
  useShowPrices: () => [false, vi.fn()],
}));
vi.mock("@/store/houseRecipes", () => ({
  useHouseRecipes: (selector: (state: { version: number }) => number) =>
    selector({ version: 0 }),
}));
vi.mock("@/components/HouseRecipeLoader", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/components/PlanWeekGrid", () => ({ default: () => null }));
vi.mock("@/components/MealDetailDialog", () => ({ default: () => null }));
vi.mock("@/components/MacroSummary", () => ({ default: () => null }));
vi.mock("@/components/TargetAdherence", () => ({ default: () => null }));
vi.mock("@/components/SegmentedToggle", () => ({ default: () => null }));

import WeekPlanner from "@/components/WeekPlanner";

const plan = (over: Partial<Plan> = {}): Plan =>
  ({
    id: "plan-1", ownerUid: "", title: "August plan",
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    targets: null, targetMode: "preset", mealSlots: ["Lunch"],
    // Week 1 is served from Monday 24 August; the default cutoff is the
    // Sunday before it at 18:00 Bali.
    programStartDate: "2026-08-24", weekCount: 1, status: "draft",
    submittedWeeks: [], assignments: [], ...over,
  }) as Plan;

const config = (over: Partial<RestaurantConfig> = {}): RestaurantConfig =>
  ({ id: "negrita", createdAt: "", updatedAt: "", ...DEFAULT_RESTAURANT_CONFIG, ...over });

async function show(at: string, over: Partial<RestaurantConfig> = {}, planOver: Partial<Plan> = {}) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(at));
  mocks.config = config(over);
  mocks.loadCurrentPlan.mockResolvedValue(plan(planOver));
  render(<WeekPlanner />);
  return screen.findByTestId("planner-cutoff");
}

describe("the deadline in the planner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listDishes.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("counts down while the week can still be sent", async () => {
    const banner = await show("2026-08-21T02:00:00.000Z");
    expect(banner.textContent).toContain("Send week 1 by");
    expect(banner.textContent).toMatch(/left/);
  });

  it("says the week is closed once the cutoff has passed", async () => {
    const banner = await show("2026-08-25T02:00:00.000Z");
    expect(banner.textContent).toContain("closed on");
    expect(banner.textContent).not.toMatch(/left/);
  });

  it("explains a kitchen that is not taking orders, instead of a dead button", async () => {
    const banner = await show("2026-08-21T02:00:00.000Z", { acceptingOrders: false });
    expect(banner.textContent).toContain("not taking orders");
    // Planning is still allowed; only sending is not.
    expect(banner.textContent).toContain("keep planning");
  });

  it("says nothing for a week the kitchen already has", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-21T02:00:00.000Z"));
    mocks.config = config();
    mocks.loadCurrentPlan.mockResolvedValue(plan({ submittedWeeks: [1] }));
    render(<WeekPlanner />);
    await screen.findByRole("button", { name: /Week 1/ });
    expect(screen.queryByTestId("planner-cutoff")).toBeNull();
  });
});
