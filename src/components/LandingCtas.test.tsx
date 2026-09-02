// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/storage/types";

const mocks = vi.hoisted(() => ({
  auth: { user: null as { uid: string } | null, role: null as Role | null, loading: false },
}));

vi.mock("@/lib/auth/AuthProvider", () => ({ useAuth: () => mocks.auth }));

import LandingCtas from "@/components/LandingCtas";

const href = (name: RegExp) =>
  screen.getByRole("link", { name }).getAttribute("href");

describe("LandingCtas", () => {
  beforeEach(() => {
    mocks.auth = { user: null, role: null, loading: false };
  });
  afterEach(cleanup);

  describe("to a visitor with no account", () => {
    /**
     * "Get started" pointed at /plan, which assumed everybody was a diner and
     * left staff onboarding reachable only by guessing the /signup URL.
     *
     * The staff link was relabelled "For Staff" upstream (5a59c62) without these
     * locators being updated, which is why they name it that now. What the test
     * is actually pinning is the destination, not the wording.
     */
    it("offers the two journeys by name, both through authentication", () => {
      render(<LandingCtas />);

      expect(href(/plan my meals/i)).toBe("/signup?intent=customer&next=%2Fplan");
      expect(href(/for staff/i)).toBe("/signup?intent=staff&next=%2Fkitchen");
    });

    it("does not offer a way into the planner that skips signing up", () => {
      render(<LandingCtas />);

      const targets = screen
        .getAllByRole("link")
        .map((link) => link.getAttribute("href"));
      expect(targets).not.toContain("/plan");
      expect(targets.every((target) => target?.startsWith("/signup"))).toBe(true);
    });

    it("says why an account is wanted, rather than that none is needed", () => {
      render(<LandingCtas />);

      expect(
        screen.getByText(/plan, orders and preferences stay with you/i)
      ).toBeTruthy();
      expect(screen.queryByText(/no account needed/i)).toBeNull();
    });
  });

  describe("to somebody already signed in", () => {
    // Making them sign up again is the kind of dead end the old header had.
    it("goes straight to the product", () => {
      mocks.auth = { user: { uid: "u1" }, role: "client", loading: false };
      render(<LandingCtas />);

      expect(href(/plan my meals/i)).toBe("/plan");
    });

    it.each(["client", "restaurant", "admin"] as const)(
      "points a %s at the kitchen, which decides what they see",
      (role) => {
        mocks.auth = { user: { uid: "u1" }, role, loading: false };
        render(<LandingCtas />);

        expect(href(/for staff/i)).toBe("/kitchen");
      }
    );
  });

  /**
   * Auth resolves after the first paint. Guessing "signed in" would flash links
   * that bounce; guessing "signed out" costs an already-authenticated visitor
   * nothing, because /signup sends them onward by itself.
   */
  it("assumes signed out while auth is still resolving", () => {
    mocks.auth = { user: null, role: null, loading: true };
    render(<LandingCtas />);

    expect(href(/plan my meals/i)).toBe("/signup?intent=customer&next=%2Fplan");
  });
});
