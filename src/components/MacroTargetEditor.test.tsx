/** @vitest-environment jsdom */
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MacroTargetEditor, { type MacroTargetSelection } from "@/components/MacroTargetEditor";
import { targetsFromStyle } from "@/lib/preferences";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function EditorHarness({ initial }: { initial: MacroTargetSelection }) {
  const [value, setValue] = useState(initial);
  return <MacroTargetEditor value={value} onChange={setValue} />;
}

describe("MacroTargetEditor preset confirmation", () => {
  it("keeps a custom editor open and focuses an inline confirmation", () => {
    const confirm = vi.spyOn(window, "confirm");
    render(<EditorHarness initial={{ mode: "custom", targets: { energy_kcal: 2000, protein_g: 190, carbs_g: 130, fat_g: 70 } }} />);

    fireEvent.click(screen.getByRole("button", { name: "Use a preset" }));

    expect(screen.getByRole("alert").textContent).toContain("This preset will replace your custom macro targets.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Use preset" }));
    expect(screen.getByRole("button", { name: "Set my own macros" }).className).toContain("border-tomato");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("cancels without changing custom targets or mode", () => {
    const confirm = vi.spyOn(window, "confirm");
    render(<EditorHarness initial={{ mode: "custom", targets: { energy_kcal: 2000, protein_g: 190, carbs_g: 130, fat_g: 70 } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Use a preset" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep custom targets" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByLabelText("Protein (g)") as HTMLInputElement).value).toBe("190");
    expect(screen.getByRole("button", { name: "Set my own macros" }).className).toContain("border-tomato");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("applies the pending preset only after confirmation", () => {
    const confirm = vi.spyOn(window, "confirm");
    render(<EditorHarness initial={{ mode: "custom", targets: { energy_kcal: 2000, protein_g: 190, carbs_g: 130, fat_g: 70 } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Use a preset" }));
    expect((screen.getByLabelText("Protein (g)") as HTMLInputElement).value).toBe("190");
    fireEvent.click(screen.getByRole("button", { name: "Use preset" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("resolved-target").textContent).toContain("Preset · Balanced");
    expect((screen.getByLabelText("Protein (g)") as HTMLInputElement).value).toBe("125");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("selects a matching preset directly when nothing would be lost", () => {
    const confirm = vi.spyOn(window, "confirm");
    render(<EditorHarness initial={{ mode: "custom", targets: targetsFromStyle(2000, "balanced") }} />);
    fireEvent.click(screen.getByRole("button", { name: "Use a preset" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("resolved-target").textContent).toContain("Preset · Balanced");
    expect(confirm).not.toHaveBeenCalled();
  });
});
