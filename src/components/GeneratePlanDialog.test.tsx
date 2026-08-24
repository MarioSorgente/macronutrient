/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GeneratePlanDialog from "@/components/GeneratePlanDialog";
import { DEFAULT_PREFERENCES, type Plan } from "@/lib/storage/types";
import type { GeneratedPlan } from "@/lib/mealPlanner";

vi.mock("@/components/MacroTargetEditor", () => ({
  default: () => <div>target editor</div>, TargetSummary: () => <div>target summary</div>,
}));
vi.mock("@/components/IngredientTypeahead", () => ({ default: () => null }));
vi.mock("@/components/TargetAdherence", () => ({ default: () => null }));

const targets = { energy_kcal: 2000, protein_g: 120, carbs_g: 220, fat_g: 70 };
const plan: Plan = {
  id: "p", ownerUid: "u", title: "Plan", createdAt: "", updatedAt: "", targets,
  targetMode: "custom", mealSlots: ["Lunch"], programStartDate: "2026-08-24",
  weekCount: 1, assignments: [], status: "draft", submittedWeeks: [], preferences: DEFAULT_PREFERENCES,
};

function generated(): GeneratedPlan {
  return { days: [{ day: 0, meals: [], unfilledSlots: ["Lunch"],
    macros: { ...targets, fiber_g: 0 }, price: { totalIdr: 0, complete: true, unpricedCount: 0 },
    adherence: { classification: "Exact", compliant: true, fields: {} } as never }],
    resolvedTarget: targets, targetSource: "explicit", targetStyle: "Explicit", targetExplanation: "" };
}

const generator = vi.fn((_options?: unknown) => generated());
vi.mock("@/lib/mealPlanner", async (original) => ({
  ...await original<typeof import("@/lib/mealPlanner")>(), generatePlanWithTargets: (options: never) => generator(options),
}));

function setup(onClose = vi.fn()) {
  render(<GeneratePlanDialog plan={plan} week={1} savedDishes={[]} onApply={vi.fn()}
    onTargetsSave={vi.fn()} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: /next/i }));
  return onClose;
}

afterEach(() => { cleanup(); vi.useRealTimers(); generator.mockClear(); });

describe("GeneratePlanDialog asynchronous generation", () => {
  it("paints and announces loading while disabling generation, target, and apply controls", async () => {
    vi.useFakeTimers(); setup();
    const generate = screen.getByRole("button", { name: /^generate$/i });
    fireEvent.click(generate);
    expect(screen.getByRole("status").textContent).toContain("Generating your week");
    expect((generate as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /change targets/i }) as HTMLButtonElement).disabled).toBe(true);
    await act(() => vi.runAllTimersAsync());
    expect((screen.getByRole("button", { name: /apply to week/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the preview and explains when repeated shuffle seeds offer no alternative", async () => {
    vi.useFakeTimers(); setup();
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    await act(() => vi.runAllTimersAsync());
    fireEvent.click(screen.getByRole("button", { name: /shuffle/i }));
    expect((screen.getByRole("button", { name: /shuffle/i }) as HTMLButtonElement).disabled).toBe(true);
    await act(() => vi.runAllTimersAsync());
    expect(screen.getByRole("status").textContent).toContain("No meaningfully different equivalent week");
    expect(screen.getByText("Preview")).toBeTruthy();
  });

  it("cancels a stale generation when the dialog closes", async () => {
    vi.useFakeTimers(); const onClose = setup();
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await act(() => vi.runAllTimersAsync());
    expect(onClose).toHaveBeenCalledOnce();
    expect(generator).not.toHaveBeenCalled();
  });
});
