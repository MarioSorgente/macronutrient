/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MacroChips from "@/components/MacroChips";
import MacroSummary from "@/components/MacroSummary";
import TargetAdherence from "@/components/TargetAdherence";
import { TargetSummary } from "@/components/MacroTargetEditor";

const targets = { energy_kcal: 2000, protein_g: 150.6, carbs_g: 200.4, fat_g: 66.7 };
afterEach(cleanup);

const actual = { energy_kcal: 1999.8, protein_g: 150.2, carbs_g: 199.6, fat_g: 66.51, fiber_g: 8.7 };

describe("whole-number macro presentation", () => {
  it("uses whole-number grams in target summaries and daily adherence", () => {
    const { rerender } = render(<TargetSummary selection={{ mode: "custom", targets }} />);
    expect(screen.getByTestId("resolved-target").textContent).toContain(
      "2,000 kcal · P 151 g · C 200 g · F 67 g"
    );

    rerender(<TargetAdherence actual={actual} targets={targets} />);
    expect(screen.getByText("150", { selector: "b" })).toBeTruthy();
    expect(screen.getByText("200", { selector: "b" })).toBeTruthy();
    expect(screen.queryByText("-0 g")).toBeNull();
  });

  it("uses whole-number grams in meal previews and macro summaries", () => {
    const { rerender } = render(<MacroChips macros={actual} variant="dots" gramSuffix />);
    expect(screen.getByText(/P 150g · C 200g · F 67g/)).toBeTruthy();

    rerender(<MacroSummary macros={actual} />);
    const labels = screen.getByText("Protein").closest(".grid")?.textContent;
    expect(labels).toContain("150Protein");
    expect(labels).toContain("200Carbs");
    expect(labels).toContain("67Fat");
    expect(labels).toContain("9Fiber");
  });
});
