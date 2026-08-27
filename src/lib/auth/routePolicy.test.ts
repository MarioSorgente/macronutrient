import { describe, expect, it } from "vitest";
import { isPublicRoute, policyFor } from "@/lib/auth/routePolicy";

/**
 * The table is the protection, so these are the tests that say what the product
 * is. A route moving from "auth" to "public" here is a decision to let anyone
 * use it, and it should be as hard to do by accident as this makes it.
 */
describe("policyFor", () => {
  it.each(["/", "/login", "/signup", "/reset", "/__/auth/handler"])(
    "leaves %s public",
    (path) => {
      expect(policyFor(path)).toEqual({ kind: "public" });
      expect(isPublicRoute(path)).toBe(true);
    }
  );

  it.each([
    "/plan",
    "/plan/build",
    "/plan/dishes",
    "/plan/submit",
    "/plan/report",
    "/orders",
    "/orders/order-1",
    "/report/dish-1",
  ])("requires the client role for %s", (path) => {
    expect(policyFor(path)).toEqual({
      kind: "role",
      allow: ["client"],
      staffIntent: false,
    });
  });

  it("requires an account for a role-neutral account page", () => {
    expect(policyFor("/account")).toEqual({ kind: "auth" });
  });

  it.each(["/kitchen", "/kitchen/2026-01-05", "/kitchen/orders"])(
    "requires the restaurant operator role for %s",
    (path) => {
    expect(policyFor(path)).toEqual({
      kind: "role",
      allow: ["restaurant"],
      staffIntent: true,
    });
    }
  );

  it.each(["/admin", "/admin/settings", "/admin/customers/uid-1"])(
    "requires the owner role for %s",
    (path) => expect(policyFor(path)).toEqual({
      kind: "role", allow: ["admin"], staffIntent: true,
    })
  );

  it("keeps house-item management available to operator and owner", () => {
    expect(policyFor("/admin/house-items")).toEqual({
      kind: "role", allow: ["restaurant", "admin"], staffIntent: true,
    });
  });

  /**
   * The whole point of a table over per-page checks: a screen added tomorrow is
   * protected because nobody listed it, not left open because nobody remembered
   * it.
   */
  it("protects a route nobody has thought about", () => {
    expect(policyFor("/some-future-feature")).toEqual({ kind: "auth" });
    expect(isPublicRoute("/some-future-feature")).toBe(false);
  });

  it("is not fooled by a trailing slash or a capital letter", () => {
    expect(policyFor("/plan/")).toEqual({
      kind: "role",
      allow: ["client"],
      staffIntent: false,
    });
    expect(policyFor("/Kitchen").kind).toBe("role");
    expect(policyFor("/")).toEqual({ kind: "public" });
  });

  // "/loginish" is not the login page, and "/kitchenware" is not the kitchen.
  it("matches whole path segments rather than prefixes", () => {
    expect(policyFor("/loginish")).toEqual({ kind: "auth" });
    expect(policyFor("/kitchenware")).toEqual({ kind: "auth" });
  });
});
