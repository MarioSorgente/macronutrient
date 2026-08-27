// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/storage/types";

type AuthShape = {
  user: { uid: string } | null;
  role: Role | null;
  loading: boolean;
  roleSettled: boolean;
  enabled: boolean;
};

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: "/plan",
  auth: {
    user: { uid: "u1" },
    role: "client",
    loading: false,
    roleSettled: true,
    enabled: true,
  } as AuthShape,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
}));
vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => mocks.auth,
}));
// The gate view is covered by its own suite; here it only needs to be
// identifiable, and it must not reach for the network.
vi.mock("@/components/StaffAccessStatus", () => ({
  default: ({ variant }: { variant?: string }) => (
    <p>staff access panel ({variant})</p>
  ),
}));

import RouteGuard from "@/components/RouteGuard";

function signedOut(over: Partial<AuthShape> = {}): AuthShape {
  return { user: null, role: null, loading: false, roleSettled: true, enabled: true, ...over };
}
function signedIn(role: Role | null, over: Partial<AuthShape> = {}): AuthShape {
  return {
    user: { uid: "u1" },
    role,
    loading: false,
    roleSettled: true,
    enabled: true,
    ...over,
  };
}

function guard() {
  return render(
    <RouteGuard>
      <p>the protected screen</p>
    </RouteGuard>
  );
}

const showsScreen = () => Boolean(screen.queryByText("the protected screen"));

describe("RouteGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = "/plan";
    mocks.auth = signedIn("client");
    window.history.replaceState({}, "", "/plan");
  });
  afterEach(cleanup);

  describe("while Firebase is still deciding who you are", () => {
    /**
     * The regression this exists for: Firebase reports "signed out" for the
     * first frame of every page load. Reading auth state before `loading`
     * clears bounces a signed-in person to the login screen on every refresh.
     */
    it("neither renders the screen nor redirects", () => {
      mocks.auth = signedOut({ loading: true });
      guard();

      expect(showsScreen()).toBe(false);
      expect(mocks.replace).not.toHaveBeenCalled();
      expect(screen.getByText(/checking your access/i)).toBeTruthy();
    });

    it("keeps a signed-in visitor's screen up once it resolves", async () => {
      mocks.auth = signedIn("client");
      guard();

      expect(showsScreen()).toBe(true);
      await waitFor(() => expect(mocks.replace).not.toHaveBeenCalled());
    });
  });

  describe("a signed-out visitor", () => {
    it.each([
      ["/plan", "/login?next=%2Fplan"],
      ["/orders", "/login?next=%2Forders"],
      ["/report/dish-1", "/login?next=%2Freport%2Fdish-1"],
      ["/account", "/login?next=%2Faccount"],
    ])("is sent from %s to %s", async (path, expected) => {
      mocks.pathname = path;
      window.history.replaceState({}, "", path);
      mocks.auth = signedOut();
      guard();

      await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(expected));
      expect(showsScreen()).toBe(false);
    });

    // Otherwise somebody who came for the kitchen is onboarded as a diner.
    it("keeps staff intent when the destination was a staff area", async () => {
      mocks.pathname = "/kitchen";
      window.history.replaceState({}, "", "/kitchen");
      mocks.auth = signedOut();
      guard();

      await waitFor(() =>
        expect(mocks.replace).toHaveBeenCalledWith("/login?intent=staff&next=%2Fkitchen")
      );
    });

    /**
     * `RequireRole` redirected with the pathname alone, so returning from a
     * sign-in dropped you on an undated kitchen board.
     */
    it("brings the query string back with them", async () => {
      mocks.pathname = "/orders";
      window.history.replaceState({}, "", "/orders?week=2");
      mocks.auth = signedOut();
      guard();

      await waitFor(() =>
        expect(mocks.replace).toHaveBeenCalledWith("/login?next=%2Forders%3Fweek%3D2")
      );
    });

    it("is left alone on a public page", () => {
      mocks.pathname = "/";
      mocks.auth = signedOut();
      guard();

      expect(showsScreen()).toBe(true);
      expect(mocks.replace).not.toHaveBeenCalled();
    });
  });

  describe("staff areas", () => {
    it("opens the kitchen for the restaurant operator", () => {
      mocks.pathname = "/kitchen";
      mocks.auth = signedIn("restaurant");
      guard();

      expect(showsScreen()).toBe(true);
    });

    it.each([
      ["client", "/plan"],
      ["admin", "/admin"],
    ] as const)("redirects a %s directly away from the kitchen", async (role, home) => {
      mocks.pathname = "/kitchen";
      mocks.auth = signedIn(role);
      guard();

      expect(showsScreen()).toBe(false);
      expect(screen.queryByText(/staff access panel/)).toBeNull();
      await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(home));
    });

    it("do the same for /admin", () => {
      mocks.pathname = "/admin";
      mocks.auth = signedIn("client");
      guard();

      expect(showsScreen()).toBe(false);
      expect(screen.getByText("staff access panel (gate)")).toBeTruthy();
    });

    /**
     * A new account's token is minted before /api/auth/sync stamps its claim.
     * Denying in that gap tells a cook who just signed up that they were
     * rejected.
     */
    it("wait for the role rather than denying a claim that has not landed", () => {
      mocks.pathname = "/kitchen";
      mocks.auth = signedIn(null, { roleSettled: false });
      guard();

      expect(screen.getByText(/checking your access/i)).toBeTruthy();
      expect(screen.queryByText(/staff access panel/)).toBeNull();
    });

    it("deny once the role really has settled as nothing", () => {
      mocks.pathname = "/kitchen";
      mocks.auth = signedIn(null, { roleSettled: true });
      guard();

      expect(screen.getByText("staff access panel (gate)")).toBeTruthy();
    });
  });

  describe("customer areas", () => {
    it.each(["/plan", "/plan/build", "/report/dish-1", "/orders/order-1"])(
      "redirects restaurant staff away from %s",
      async (path) => {
        mocks.pathname = path;
        mocks.auth = signedIn("restaurant");
        guard();

        expect(showsScreen()).toBe(false);
        expect(screen.queryByText(/staff access panel/)).toBeNull();
        await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/kitchen"));
      }
    );

    it("redirects administrators unless View as makes their effective role client", async () => {
      mocks.auth = signedIn("admin");
      const view = guard();
      await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/admin"));

      vi.clearAllMocks();
      mocks.auth = signedIn("client");
      view.rerender(
        <RouteGuard>
          <p>the protected screen</p>
        </RouteGuard>
      );
      expect(showsScreen()).toBe(true);
      expect(mocks.replace).not.toHaveBeenCalled();
    });
  });

  describe("a build with no Firebase configuration", () => {
    /**
     * Redirecting would loop: the login form cannot sign anybody in either.
     * Before accounts were required this deployment quietly served a guest
     * planner, which is how it went unnoticed.
     */
    it("says what is broken instead of bouncing to a form that cannot work", () => {
      mocks.pathname = "/plan";
      mocks.auth = signedOut({ enabled: false });
      guard();

      expect(showsScreen()).toBe(false);
      expect(mocks.replace).not.toHaveBeenCalled();
      expect(screen.getByText(/accounts are not available in this build/i)).toBeTruthy();
    });

    it("still serves the landing page", () => {
      mocks.pathname = "/";
      mocks.auth = signedOut({ enabled: false });
      guard();

      expect(showsScreen()).toBe(true);
    });
  });
});
