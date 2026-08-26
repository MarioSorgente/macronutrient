/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The date in the URL is hand-typed often enough to matter — the board links to
 * the previous and next day, so people edit it directly.
 *
 * A shape-only check let "2026-02-31" through. It matches yyyy-mm-dd but is not
 * a date, and `addDays` throws on anything it cannot parse, so the board blew up
 * while rendering its own navigation instead of falling back to today.
 */

const mocks = vi.hoisted(() => ({ date: undefined as string | undefined }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ date: mocks.date }),
}));
vi.mock("@/components/KitchenBoard", () => ({
  default: ({ date }: { date?: string }) => <p>board:{date ?? "today"}</p>,
}));

import KitchenDay from "@/components/KitchenDay";

afterEach(cleanup);

function shown(date: string | undefined): string {
  mocks.date = date;
  render(<KitchenDay />);
  return screen.getByText(/^board:/).textContent ?? "";
}

describe("KitchenDay", () => {
  it("passes a real calendar date through", () => {
    expect(shown("2026-08-24")).toBe("board:2026-08-24");
  });

  it("accepts a genuine leap day", () => {
    expect(shown("2028-02-29")).toBe("board:2028-02-29");
  });

  it("falls back to today for a date that only looks like one", () => {
    // February 31 matches the pattern and does not exist.
    expect(shown("2026-02-31")).toBe("board:today");
  });

  it("falls back to today for junk", () => {
    expect(shown("not-a-date")).toBe("board:today");
  });

  it("falls back to today when the param is missing", () => {
    expect(shown(undefined)).toBe("board:today");
  });
});
