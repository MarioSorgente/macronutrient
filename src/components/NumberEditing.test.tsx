// @vitest-environment jsdom

import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NumberField from "@/components/ui/NumberField";
import Modal from "@/components/ui/Modal";
import IngredientTypeahead from "@/components/IngredientTypeahead";

/**
 * Typing a number, and keeping the window open while you do it.
 *
 * Every numeric field here was a controlled `<input type="number">` bound to a
 * number, so clearing it parsed to `NaN`, `|| 0` turned that into zero, and the
 * field refilled under the cursor: changing 2,000 kcal to 2,500 meant selecting
 * the value first, and a stray keystroke left a target of 0. And selecting that
 * value by dragging across it released the mouse on the backdrop, which every
 * dialog took as a click away and closed — losing the meal being built.
 */

afterEach(cleanup);

function Harness({ decimals = false, start = 2000 }: { decimals?: boolean; start?: number }) {
  const [value, setValue] = useState(start);
  return (
    <>
      <NumberField aria-label="Calories" decimals={decimals} value={value} onChange={setValue} />
      <output data-testid="committed">{value}</output>
    </>
  );
}

const field = () => screen.getByLabelText("Calories") as HTMLInputElement;
const committed = () => screen.getByTestId("committed").textContent;

describe("typing into a number field", () => {
  it("can be emptied, and stays empty while you are typing", () => {
    render(<Harness />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "" } });

    // The old behaviour put a 0 here on the first backspace.
    expect(field().value).toBe("");
    expect(committed()).toBe("2000");
  });

  it("takes what you type, digit by digit", () => {
    render(<Harness />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "" } });
    for (const partial of ["2", "25", "250", "2500"]) {
      fireEvent.change(field(), { target: { value: partial } });
    }

    expect(field().value).toBe("2500");
    expect(committed()).toBe("2500");
  });

  it("puts back what was there if you leave it empty", () => {
    render(<Harness />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "" } });
    fireEvent.blur(field());

    // Not zero, which is not a target anybody meant to set.
    expect(field().value).toBe("2000");
    expect(committed()).toBe("2000");
  });

  it("accepts a decimal where a decimal means something", () => {
    render(<Harness decimals start={66.7} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "" } });
    fireEvent.change(field(), { target: { value: "66." } });
    // A half-written decimal is not a number yet, so nothing is committed.
    expect(committed()).toBe("66.7");

    fireEvent.change(field(), { target: { value: "66.4" } });
    expect(committed()).toBe("66.4");
  });

  it("rounds to whole numbers only where fractions are meaningless", () => {
    render(<Harness start={10} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "12.6" } });
    fireEvent.blur(field());

    expect(committed()).toBe("13");
  });

  it("holds the floor rather than going below it", () => {
    render(<Harness start={10} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "-40" } });
    fireEvent.blur(field());

    expect(committed()).toBe("0");
  });

  it("ignores the scroll wheel", () => {
    render(<Harness />);
    const input = field();
    input.focus();
    const blur = vi.spyOn(input, "blur");
    fireEvent.wheel(input, { deltaY: -100 });

    // A focused number input treats a scroll as an increment, so the field
    // steps aside rather than letting a scrolled page rewrite a target.
    expect(blur).toHaveBeenCalled();
    expect(committed()).toBe("2000");
  });
});

describe("clicking around a dialog", () => {
  const openModal = (onClose: () => void) =>
    render(
      <Modal title="Daily targets" onClose={onClose}>
        <input aria-label="Calories" defaultValue="2000" />
      </Modal>
    );

  it("stays open when a drag that began inside it ends on the backdrop", () => {
    const onClose = vi.fn();
    const { container } = openModal(onClose);
    const backdrop = container.firstElementChild as HTMLElement;

    // Selecting the text of a field and releasing just outside the panel: the
    // browser reports that as a click on the backdrop.
    fireEvent.mouseDown(screen.getByLabelText("Calories"));
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("still closes when you click away from it", () => {
    const onClose = vi.fn();
    const { container } = openModal(onClose);
    const backdrop = container.firstElementChild as HTMLElement;

    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not close when a click lands inside the panel", () => {
    const onClose = vi.fn();
    openModal(onClose);

    fireEvent.mouseDown(screen.getByLabelText("Calories"));
    fireEvent.click(screen.getByLabelText("Calories"));

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("searching for an ingredient inside a dialog", () => {
  const openTypeahead = (onClose: () => void, onSelect = vi.fn()) => {
    render(
      <Modal title="Build a meal" onClose={onClose}>
        <IngredientTypeahead placeholder="Search ingredients…" excludeIds={[]} onSelect={onSelect} />
      </Modal>
    );
    return onSelect;
  };

  it("gives Escape to the suggestions before the dialog", () => {
    const onClose = vi.fn();
    openTypeahead(onClose);
    const search = screen.getByLabelText("Search ingredients…");
    fireEvent.change(search, { target: { value: "chicken" } });

    fireEvent.keyDown(search, { key: "Escape" });

    // The list goes; the meal being built does not.
    expect((search as HTMLInputElement).value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the dialog on Escape once there is nothing to dismiss", () => {
    const onClose = vi.fn();
    openTypeahead(onClose);

    fireEvent.keyDown(screen.getByLabelText("Search ingredients…"), { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("takes the first match on Enter", () => {
    const onSelect = openTypeahead(vi.fn());
    const search = screen.getByLabelText("Search ingredients…");
    fireEvent.change(search, { target: { value: "chicken" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledOnce();
    expect((search as HTMLInputElement).value).toBe("");
  });
});
