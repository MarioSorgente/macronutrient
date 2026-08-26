// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConfirmButton from "@/components/ui/ConfirmButton";
import PlanWeekGrid from "@/components/PlanWeekGrid";
import MealDetailDialog from "@/components/MealDetailDialog";
import AssignDishDialog from "@/components/AssignDishDialog";
import type { Assignment, Dish, Plan } from "@/lib/storage/types";

/**
 * A week the kitchen already has is not editable, and destructive buttons fire
 * once.
 *
 * Sending a week to Negrita copies it into an order and refuses a resend, so
 * every change made to that week afterwards was a change that could never
 * reach the kitchen: the planner showed one week while the restaurant cooked
 * another, and nothing on screen said so.
 */

vi.mock("@/lib/storage/repos", () => ({
  useRepos: () => ({ plans: {}, dishes: {}, houseRecipes: {}, uid: null, loading: false }),
}));

afterEach(cleanup);

const SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];
const meal: Assignment = {
  id: "a1", week: 1, day: 0, slot: "Breakfast", servings: 1,
  price: { totalIdr: 50_000, complete: true },
  snapshot: { name: "Breakfast plate",
    totals: { energy_kcal: 400, protein_g: 30, carbs_g: 40, fat_g: 10, fiber_g: 2 } },
} as unknown as Assignment;

const plan: Plan = {
  id: "primary", ownerUid: "", title: "My week", createdAt: "", updatedAt: "",
  targets: null, targetMode: "custom", mealSlots: SLOTS,
  programStartDate: "2026-08-17", weekCount: 1, status: "draft",
  submittedWeeks: [1], assignments: [meal],
} as unknown as Plan;

describe("a week that is with the kitchen", () => {
  it("offers no way to add a meal to it", () => {
    const onAddMeal = vi.fn();
    render(
      <PlanWeekGrid plan={plan} week={1} dishes={new Map<string, Dish>()}
        showPrices={false} onOpenMeal={() => {}} onAddMeal={onAddMeal} locked />
    );

    const add = screen.getAllByRole("button", { name: /add to breakfast on mon/i })[0];
    expect((add as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(add);
    expect(onAddMeal).not.toHaveBeenCalled();
  });

  it("still lets you add when the week has not been sent", () => {
    const onAddMeal = vi.fn();
    render(
      <PlanWeekGrid plan={plan} week={1} dishes={new Map<string, Dish>()}
        showPrices={false} onOpenMeal={() => {}} onAddMeal={onAddMeal} />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /add to breakfast on mon/i })[0]);
    expect(onAddMeal).toHaveBeenCalled();
  });

  it("shows a meal without offering to change or remove it", () => {
    const onRemove = vi.fn();
    const onChangeServings = vi.fn();
    render(
      <MealDetailDialog assignment={meal} dishes={new Map<string, Dish>()}
        contextLabel="Breakfast · Monday" locked
        onChangeServings={onChangeServings} onRemove={onRemove} onClose={() => {}} />
    );

    expect(screen.queryByText("Remove from plan")).toBeNull();
    expect(screen.getByText(/cancel the order to change this week/i)).toBeTruthy();
    expect((screen.getByLabelText("More servings") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the planner's add-to-slot dialog", () => {
  const open = (onClose = vi.fn()) => {
    render(
      <AssignDishDialog dishes={[]} dishesLoading={false} dishesError={null}
        slot="Breakfast" dayLabel="Week 1 · Monday" onAssign={() => {}}
        onAssignMenuDish={() => {}} onAssignCustom={() => {}} onClose={onClose} />
    );
    return onClose;
  };

  it("closes on Escape, like every other dialog", () => {
    const onClose = open();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("stops the week behind it from scrolling while it is open", () => {
    const { unmount } = render(
      <AssignDishDialog dishes={[]} dishesLoading={false} dishesError={null}
        slot="Breakfast" dayLabel="Week 1 · Monday" onAssign={() => {}}
        onAssignMenuDish={() => {}} onAssignCustom={() => {}} onClose={() => {}} />
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});

describe("confirming something destructive", () => {
  it("runs the action once, however many times it is clicked", async () => {
    let release: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    render(<ConfirmButton text="Cancel this week" confirmLabel="Yes, cancel it"
      label="Cancel this order" onConfirm={onConfirm} />);

    fireEvent.click(screen.getByText("Cancel this week"));
    const confirm = screen.getByText("Yes, cancel it");
    fireEvent.click(confirm);
    // Second click while the first request is still in flight.
    fireEvent.click(screen.getByText("Working…"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    release();
  });
});
