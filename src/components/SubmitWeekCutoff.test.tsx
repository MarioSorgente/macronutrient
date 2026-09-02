// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RESTAURANT_CONFIG,
  type Dish,
  type Plan,
  type RestaurantConfig,
} from "@/lib/storage/types";

/**
 * The deadline on the screen the deadline actually gates.
 *
 * `cutoffState` reads the clock itself when nothing is passed to it, so a
 * `useMemo` over it is frozen at mount. The planner solved that with a ticking
 * clock; the submit screen did not — so somebody who opened it a few minutes
 * before the cutoff kept a countdown reading "12m left" and a live Send button
 * long after the kitchen had closed the week, and learned otherwise from a 409.
 *
 * Both screens share `useMinuteTick` now, so they cannot drift apart again.
 */

const mocks = vi.hoisted(() => ({
  loadCurrentPlan: vi.fn(),
  listDishes: vi.fn(),
  submitWeek: vi.fn(),
  config: null as RestaurantConfig | null,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { uid: "u1" }, loading: false }),
}));
vi.mock("@/lib/currentPlan", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/currentPlan")>(),
  loadCurrentPlan: mocks.loadCurrentPlan,
}));
vi.mock("@/lib/storage/repos", () => ({
  useRepos: () => ({
    plans: { save: vi.fn() },
    dishes: { list: mocks.listDishes },
    uid: "u1",
    loading: false,
  }),
}));
vi.mock("@/lib/storage/orders", () => ({
  loadRestaurantConfig: () => Promise.resolve(mocks.config),
  submitWeek: mocks.submitWeek,
}));
vi.mock("@/lib/auth/profile", () => ({ readStoredProfile: () => Promise.resolve({}) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

import SubmitWeek from "@/components/SubmitWeek";

const EMPTY = { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };

const plan = (): Plan =>
  ({
    id: "plan-1", ownerUid: "u1", title: "August plan",
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    targets: null, targetMode: "preset", mealSlots: ["Lunch"],
    // Week 1 is served from Monday 24 August; the default cutoff is the Sunday
    // before it at 18:00 Bali, which is 2026-08-23T10:00:00Z.
    programStartDate: "2026-08-24", weekCount: 1, status: "draft",
    submittedWeeks: [],
    assignments: [{
      id: "a1", week: 1, day: 0, slot: "Lunch", servings: 1,
      dishId: "d1",
      snapshot: { name: "Nasi", totals: EMPTY },
    }],
  }) as unknown as Plan;

const dish = (): Dish =>
  ({
    id: "d1", createdAt: "", updatedAt: "", ownerUid: "u1", name: "Nasi",
    items: [], totals: EMPTY,
  }) as unknown as Dish;

const sendButton = () => screen.getByRole("button", { name: /Send week 1 to the kitchen/i });

async function open(at: string) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(at));
  mocks.config = { id: "negrita", createdAt: "", updatedAt: "", ...DEFAULT_RESTAURANT_CONFIG };
  mocks.loadCurrentPlan.mockResolvedValue(plan());
  mocks.listDishes.mockResolvedValue([dish()]);
  render(<SubmitWeek />);
  await screen.findByRole("button", { name: /Send week 1 to the kitchen/i });
}

describe("the deadline on the submit screen", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("offers the send while the week is still open", async () => {
    await open("2026-08-23T09:50:00.000Z");
    expect(sendButton().hasAttribute("disabled")).toBe(false);
  });

  it("stops offering it when the deadline passes with the screen open", async () => {
    await open("2026-08-23T09:50:00.000Z");
    expect(sendButton().hasAttribute("disabled")).toBe(false);

    // Fifteen minutes later. Nothing was clicked and nothing reloaded — this is
    // somebody who left the tab open through the cutoff.
    await act(async () => {
      vi.advanceTimersByTime(15 * 60_000);
    });

    expect(sendButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText(/closed on/i).length).toBeGreaterThan(0);
    expect(mocks.submitWeek).not.toHaveBeenCalled();
  });
});
