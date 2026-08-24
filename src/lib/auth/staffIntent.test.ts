import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/storage/types";

const mocks = vi.hoisted(() => ({
  getApi: vi.fn(),
  callApi: vi.fn(),
  getIdToken: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ getApi: mocks.getApi, callApi: mocks.callApi }));
vi.mock("@/lib/storage/firebaseAuth", () => ({
  getAuthClient: () => ({ currentUser: { getIdToken: mocks.getIdToken } }),
}));

const { resolveStaffDestination } = await import("@/lib/auth/staffIntent");

/** Answers /api/auth/sync with a role, and every other POST with a bare ok. */
function reconcilesTo(role: Role | null, { changed = false } = {}) {
  mocks.callApi.mockImplementation(async (path: string) => {
    if (path === "/api/auth/sync") {
      if (role === null) throw new Error("server unreachable");
      return { role, changed };
    }
    return { status: "pending" };
  });
}

const syncCalls = () =>
  mocks.callApi.mock.calls.filter(([path]) => path === "/api/auth/sync").length;
const requestCalls = () =>
  mocks.callApi.mock.calls.filter(
    ([path]) => path === "/api/staff/request-access"
  ).length;

/**
 * "I work at Negrita" is one click that has to mean five different things.
 * Sending everybody to `/kitchen` and letting authorization fail is what the
 * signup form used to do, and it is why an existing customer who worked in the
 * kitchen could never get in.
 */
describe("resolveStaffDestination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getIdToken.mockResolvedValue("token");
  });

  it.each(["restaurant", "admin"] as const)(
    "sends a %s straight to the kitchen, filing nothing",
    async (role) => {
      reconcilesTo(role);

      await expect(resolveStaffDestination()).resolves.toBe("/kitchen");
      expect(mocks.getApi).not.toHaveBeenCalled();
      expect(requestCalls()).toBe(0);
    }
  );

  /**
   * The guard tags `/admin` as a staff route, so an owner bounced off it signs
   * in with staff intent. Ignoring where they were going would land them in the
   * kitchen instead of the dashboard they asked for.
   */
  it("returns staff to the destination they were bounced off", async () => {
    reconcilesTo("admin");

    await expect(resolveStaffDestination("/admin/settings")).resolves.toBe(
      "/admin/settings"
    );
  });

  it("falls back to the kitchen when no destination was asked for", async () => {
    reconcilesTo("restaurant");

    await expect(resolveStaffDestination("")).resolves.toBe("/kitchen");
  });

  /**
   * The claim is granted server-side, so it is not on this token yet. Routing
   * before refreshing would hand the guard a role the server has just replaced.
   */
  it("puts a newly granted claim on the token before routing", async () => {
    reconcilesTo("admin", { changed: true });

    await resolveStaffDestination("/kitchen");
    expect(mocks.getIdToken).toHaveBeenCalledWith(true);
  });

  it("does not force a refresh when nothing changed", async () => {
    reconcilesTo("restaurant");

    await resolveStaffDestination("/kitchen");
    expect(mocks.getIdToken).not.toHaveBeenCalled();
  });

  describe("somebody who is not staff yet", () => {
    it("has a request filed if they have never asked", async () => {
      reconcilesTo("client");
      mocks.getApi.mockResolvedValue({ request: null });

      await expect(resolveStaffDestination()).resolves.toBe(
        "/account?staff-requested=1"
      );
      expect(mocks.callApi).toHaveBeenCalledWith("/api/staff/request-access");
    });

    it("does not get a second request while one is pending", async () => {
      reconcilesTo("client");
      mocks.getApi.mockResolvedValue({ request: { status: "pending" } });

      await expect(resolveStaffDestination()).resolves.toBe(
        "/account?staff-requested=1"
      );
      expect(requestCalls()).toBe(0);
    });

    /**
     * An approved request with a customer claim means the token predates the
     * grant. Filing another would put a settled request back into the owner's
     * queue; the account screen activates the role instead.
     */
    it("does not re-open a request that has already been approved", async () => {
      reconcilesTo("client");
      mocks.getApi.mockResolvedValue({ request: { status: "approved" } });

      await expect(resolveStaffDestination()).resolves.toBe(
        "/account?staff-requested=1"
      );
      expect(requestCalls()).toBe(0);
    });

    it("can ask again after being turned down", async () => {
      reconcilesTo("client");
      mocks.getApi.mockResolvedValue({ request: { status: "rejected" } });

      await expect(resolveStaffDestination()).resolves.toBe(
        "/account?staff-requested=1"
      );
      expect(requestCalls()).toBe(1);
    });

    /**
     * `/kitchen` is exactly where they cannot go, so their requested
     * destination is deliberately ignored in favour of the request flow.
     */
    it("is sent to the request flow rather than where they aimed", async () => {
      reconcilesTo("client");
      mocks.getApi.mockResolvedValue({ request: { status: "pending" } });

      await expect(resolveStaffDestination("/kitchen")).resolves.toBe(
        "/account?staff-requested=1"
      );
    });
  });

  /**
   * Reconciliation is also what grants owner access to an allowlisted address,
   * so a failing server must not strand somebody on the sign-in screen. The
   * request API is the authority on what happens next regardless.
   */
  it("carries on when reconciliation fails outright", async () => {
    reconcilesTo(null);
    mocks.getApi.mockResolvedValue({ request: null });

    await expect(resolveStaffDestination()).resolves.toBe(
      "/account?staff-requested=1"
    );
  });

  /**
   * Somebody who has just proved who they are must never be left looking at the
   * sign-in form. The account screen shows the real state and offers a retry.
   */
  it("still lands somewhere useful when the request API is unreachable", async () => {
    reconcilesTo("client");
    mocks.getApi.mockRejectedValue(new Error("server unreachable"));

    await expect(resolveStaffDestination()).resolves.toBe(
      "/account?staff-requested=1"
    );
  });

  it("and when filing the request itself fails", async () => {
    mocks.callApi.mockImplementation(async (path: string) => {
      if (path === "/api/auth/sync") return { role: "client", changed: false };
      throw new Error("server unreachable");
    });
    mocks.getApi.mockResolvedValue({ request: null });

    await expect(resolveStaffDestination()).resolves.toBe(
      "/account?staff-requested=1"
    );
  });

  // The server is the authority; asking first is only how a second click avoids
  // filing a second record.
  it("reconciles before asking anything about requests", async () => {
    const order: string[] = [];
    mocks.callApi.mockImplementation(async (path: string) => {
      order.push(path);
      return path === "/api/auth/sync"
        ? { role: "client", changed: false }
        : { status: "pending" };
    });
    mocks.getApi.mockImplementation(async () => {
      order.push("GET /api/staff/request-access");
      return { request: { status: "pending" } };
    });

    await resolveStaffDestination();
    expect(order).toEqual(["/api/auth/sync", "GET /api/staff/request-access"]);
    expect(syncCalls()).toBe(1);
  });
});
