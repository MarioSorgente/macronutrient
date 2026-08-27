/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PlanWeekGrid from "@/components/PlanWeekGrid";
import PlanDayView from "@/components/PlanDayView";
import MealDetailDialog from "@/components/MealDetailDialog";
import { MEAL_DRAG_TYPE } from "@/components/mealDrag";
import type { Assignment, Dish, Plan } from "@/lib/storage/types";

/**
 * Moving a planned meal.
 *
 * The drag is the shortcut; the dialog's "Move to" is the way. HTML5 drag
 * events do not fire on touch and cannot be reached from a keyboard, so a
 * drag-only implementation would ship a desktop-only feature to an app with a
 * mobile Playwright project.
 */

afterEach(cleanup);

const NO_MACROS = { energy_kcal: 400, protein_g: 30, carbs_g: 40, fat_g: 10, fiber_g: 2 };

const meal = (over: Partial<Assignment> = {}): Assignment => ({
  id: "a1", week: 1, day: 0, slot: "Breakfast", servings: 1,
  items: [], snapshot: { name: "Porridge", totals: NO_MACROS }, ...over,
});

const plan = (assignments: Assignment[]): Plan => ({
  id: "p1", createdAt: "", updatedAt: "", name: "Plan",
  programStartDate: "2026-08-24", weeks: 1,
  mealSlots: ["Breakfast", "Lunch", "Dinner"],
  assignments, targets: null, targetMode: "manual",
  preferences: { proteinLean: [], avoidIngredientIds: [] },
  submittedWeeks: [],
} as unknown as Plan);

/** A DataTransfer stub: jsdom does not implement one. */
function dataTransfer(payload?: object) {
  const store = new Map<string, string>();
  if (payload) store.set(MEAL_DRAG_TYPE, JSON.stringify(payload));
  return {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
    get types() { return [...store.keys()]; },
    effectAllowed: "none",
    dropEffect: "none",
  };
}

const grid = (onMoveMeal: ReturnType<typeof vi.fn>, locked = false) =>
  render(
    <PlanWeekGrid plan={plan([meal()])} week={1} dishes={new Map<string, Dish>()}
      showPrices={false} onOpenMeal={() => {}} onAddMeal={() => {}}
      onMoveMeal={onMoveMeal} locked={locked} />
  );

const slotCell = (container: HTMLElement, key: string) =>
  container.querySelector(`[data-drop-slot="${key}"]`) as HTMLElement;

describe("dragging a meal in the week grid", () => {
  it("moves it to the day and slot it is dropped on", () => {
    const onMoveMeal = vi.fn();
    const { container } = grid(onMoveMeal);

    const card = screen.getByText("Porridge").closest("button")!;
    fireEvent.dragStart(card, { dataTransfer: dataTransfer() });

    const target = slotCell(container, "2:Dinner");
    expect(target).toBeTruthy();
    fireEvent.drop(target, {
      dataTransfer: dataTransfer({
        assignmentId: "a1", fromDay: 0, fromSlot: "Breakfast",
      }),
    });

    expect(onMoveMeal).toHaveBeenCalledWith("a1", 2, "Dinner");
  });

  it("does nothing when dropped back where it started", () => {
    const onMoveMeal = vi.fn();
    const { container } = grid(onMoveMeal);
    fireEvent.drop(slotCell(container, "0:Breakfast"), {
      dataTransfer: dataTransfer({
        assignmentId: "a1", fromDay: 0, fromSlot: "Breakfast",
      }),
    });
    expect(onMoveMeal).not.toHaveBeenCalled();
  });

  it("ignores a drag that is not one of ours", () => {
    // A file or a text selection dropped on the grid must not move a meal.
    const onMoveMeal = vi.fn();
    const { container } = grid(onMoveMeal);
    const transfer = dataTransfer();
    transfer.setData("text/plain", "a1");
    fireEvent.drop(slotCell(container, "1:Lunch"), { dataTransfer: transfer });
    expect(onMoveMeal).not.toHaveBeenCalled();
  });

  it("offers no drop target at all once the kitchen has the week", () => {
    const { container } = grid(vi.fn(), true);
    expect(container.querySelector("[data-drop-slot]")).toBeNull();
    expect(screen.getByText("Porridge").closest("button")!.draggable).toBe(false);
  });
});

describe("dragging a meal between slots in the day view", () => {
  it("moves it within the day it is showing", () => {
    const onMoveMeal = vi.fn();
    const { container } = render(
      <PlanDayView plan={plan([meal()])} week={1} day={0}
        dishes={new Map<string, Dish>()} showPrices={false}
        onSelectDay={() => {}} onOpenMeal={() => {}} onAddMeal={() => {}}
        onMoveMeal={onMoveMeal} />
    );
    fireEvent.drop(slotCell(container, "Lunch"), {
      dataTransfer: dataTransfer({
        assignmentId: "a1", fromDay: 0, fromSlot: "Breakfast",
      }),
    });
    expect(onMoveMeal).toHaveBeenCalledWith("a1", 0, "Lunch");
  });
});

describe("the move control in the meal dialog", () => {
  const open = (onMove: ReturnType<typeof vi.fn>) =>
    render(
      <MealDetailDialog assignment={meal()} dishes={new Map<string, Dish>()}
        contextLabel="Breakfast · Monday"
        mealSlots={["Breakfast", "Lunch", "Dinner"]}
        dayNames={["Monday", "Tuesday", "Wednesday"]}
        onMove={onMove} onChangeServings={() => {}} onRemove={() => {}}
        onClose={() => {}} />
    );

  it("lists exactly the plan's own slots", () => {
    open(vi.fn());
    const select = screen.getByLabelText("Move to slot") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value))
      .toEqual(["Breakfast", "Lunch", "Dinner"]);
  });

  it("moves to another slot on the same day", () => {
    const onMove = vi.fn();
    open(onMove);
    fireEvent.change(screen.getByLabelText("Move to slot"), {
      target: { value: "Dinner" },
    });
    expect(onMove).toHaveBeenCalledWith(0, "Dinner");
  });

  it("moves to another day in the same slot", () => {
    const onMove = vi.fn();
    open(onMove);
    fireEvent.change(screen.getByLabelText("Move to day"), {
      target: { value: "2" },
    });
    expect(onMove).toHaveBeenCalledWith(2, "Breakfast");
  });
});
