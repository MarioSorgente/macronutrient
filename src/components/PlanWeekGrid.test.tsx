// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "@/lib/storage/types";
import PlanWeekGrid from "@/components/PlanWeekGrid";

afterEach(cleanup);

const plan: Plan = {
  id: "plan-1",
  ownerUid: "",
  title: "Planner",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  programStartDate: "2026-08-24",
  weekCount: 1,
  status: "draft",
  submittedWeeks: [],
  mealSlots: ["Lunch"],
  targets: { energy_kcal: 600, protein_g: 35, carbs_g: 70, fat_g: 20 },
  targetMode: "custom",
  assignments: [{
    id: "meal-1",
    week: 1,
    day: 0,
    slot: "Lunch",
    dishId: "missing-dish",
    servings: 1,
    snapshot: {
      name: "Nasi campur",
      totals: { energy_kcal: 600, protein_g: 35, carbs_g: 70, fat_g: 20, fiber_g: 5 },
    },
  }],
};

function renderGrid() {
  return render(
    <PlanWeekGrid
      plan={plan}
      week={1}
      dishes={new Map()}
      showPrices={false}
      onOpenMeal={vi.fn()}
      onAddMeal={vi.fn()}
    />
  );
}

describe("PlanWeekGrid daily summary", () => {
  it("uses a concise adherence status in each selectable day footer", () => {
    renderGrid();

    const monday = screen.getByRole("button", { name: /view summary for monday/i });
    expect(monday.getAttribute("aria-pressed")).toBe("false");
    expect(monday.textContent).toContain("600");
    expect(monday.textContent).toContain("Within target");
    expect(monday.textContent).not.toContain("Protein");
  });

  it("selects a day and opens and closes its responsive detail view", () => {
    renderGrid();

    const monday = screen.getByRole("button", { name: /view summary for monday/i });
    fireEvent.click(monday);

    expect(monday.getAttribute("aria-pressed")).toBe("true");
    const dialog = screen.getByRole("dialog", { name: /monday/i });
    expect(dialog.textContent).toContain("Calories");
    expect(dialog.textContent).toContain("Protein");
    expect(dialog.textContent).toContain("Carbohydrates");
    expect(dialog.textContent).toContain("Fat");
    expect(dialog.textContent).toContain("Price");
    expect(dialog.textContent).toContain("target");

    fireEvent.click(screen.getByRole("button", { name: "Close daily summary" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(monday.getAttribute("aria-pressed")).toBe("false");
  });
});
