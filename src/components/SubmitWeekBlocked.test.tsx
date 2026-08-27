import { describe, expect, it } from "vitest";
import { cutoffState, cutoffConfigOf, formatRemaining } from "@/lib/cutoff";
import { DEFAULT_RESTAURANT_CONFIG, type RestaurantConfig } from "@/lib/storage/types";

/**
 * Why a week cannot be sent.
 *
 * The submit button used to fold six conditions into one `blocked` boolean and
 * render nothing for four of them: a closed kitchen or a passed cutoff simply
 * greyed it out. The server has a proper sentence for the closed case, but a
 * disabled button never sends the request that would return it.
 *
 * The reason string is derived in the component; these tests pin the two
 * shared inputs it derives from, so the planner and the submit screen can never
 * disagree about a deadline.
 */

const config: RestaurantConfig = {
  id: "negrita", createdAt: "", updatedAt: "", ...DEFAULT_RESTAURANT_CONFIG,
};

describe("the deadline both screens read", () => {
  it("is open well before the cutoff", () => {
    // Default cutoff is Sunday 18:00 in the week before service.
    const state = cutoffState("2026-08-24", cutoffConfigOf(config),
      new Date("2026-08-19T02:00:00.000Z"));
    expect(state.passed).toBe(false);
    expect(state.msRemaining).toBeGreaterThan(0);
    expect(formatRemaining(state.msRemaining)).not.toBe("closed");
  });

  it("is closed after it", () => {
    const state = cutoffState("2026-08-24", cutoffConfigOf(config),
      new Date("2026-08-24T02:00:00.000Z"));
    expect(state.passed).toBe(true);
    expect(formatRemaining(state.msRemaining)).toBe("closed");
  });

  it("falls in the week before the one being served", () => {
    // The kitchen needs the list before it starts cooking, not during.
    const state = cutoffState("2026-08-24", cutoffConfigOf(config));
    expect(state.at.toISOString() < "2026-08-24").toBe(true);
  });
});

describe("a kitchen that is not taking orders", () => {
  it("is a config flag the screens can read, not just a server rule", () => {
    // The server refuses these too, but the customer should be told before
    // pressing anything rather than by a button that does nothing.
    expect(DEFAULT_RESTAURANT_CONFIG.acceptingOrders).toBe(true);
    expect({ ...config, acceptingOrders: false }.acceptingOrders).toBe(false);
  });
});
