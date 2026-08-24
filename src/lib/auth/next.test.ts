import { describe, expect, it } from "vitest";
import { authUrl, readIntent, safeNext } from "@/lib/auth/next";

/**
 * `next` is the one value on the sign-in screens an attacker chooses. Every
 * case below is a way to leave the origin while still looking like a path, and
 * the original implementation — `params.get("next") || "/plan"` — accepted all
 * of them.
 */
describe("safeNext", () => {
  it("keeps an internal path, with its query and hash", () => {
    expect(safeNext("/plan")).toBe("/plan");
    expect(safeNext("/orders?week=2")).toBe("/orders?week=2");
    expect(safeNext("/kitchen/2026-01-05")).toBe("/kitchen/2026-01-05");
    expect(safeNext("/plan#week-2")).toBe("/plan#week-2");
  });

  it.each([
    ["an absolute URL", "https://evil.example"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash protocol-relative URL", "/\\evil.example"],
    ["a backslash-slash pair", "/\\/evil.example"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,<script>alert(1)</script>"],
    ["a bare host", "evil.example/plan"],
    ["an empty string", ""],
    ["nothing at all", null],
    ["something that is not a string", 42 as unknown as string],
  ])("refuses %s", (_label, value) => {
    expect(safeNext(value)).toBe("/plan");
  });

  it("refuses a control character, which a browser would strip back into a scheme", () => {
    expect(safeNext("/\u0001/evil.example")).toBe("/plan");
    expect(safeNext("/plan\nSet-Cookie: x=1")).toBe("/plan");
  });

  it("honours a caller's own fallback", () => {
    expect(safeNext("https://evil.example", "/account")).toBe("/account");
    expect(safeNext(null, "")).toBe("");
  });
});

describe("authUrl", () => {
  it("carries intent and destination together", () => {
    expect(authUrl("signup", { next: "/kitchen", intent: "staff" })).toBe(
      "/signup?intent=staff&next=%2Fkitchen"
    );
    expect(authUrl("signup", { next: "/plan", intent: "customer" })).toBe(
      "/signup?intent=customer&next=%2Fplan"
    );
  });

  it("omits what it was not given", () => {
    expect(authUrl("login")).toBe("/login");
    expect(authUrl("login", { next: "/orders" })).toBe("/login?next=%2Forders");
    expect(authUrl("login", { intent: "staff" })).toBe("/login?intent=staff");
  });

  // Otherwise the sanitising is only as good as the least careful caller.
  it("drops a destination that would leave the origin", () => {
    expect(authUrl("login", { next: "https://evil.example" })).toBe("/login");
    expect(authUrl("login", { next: "//evil.example", intent: "staff" })).toBe(
      "/login?intent=staff"
    );
  });
});

describe("readIntent", () => {
  it("recognises the two journeys and nothing else", () => {
    expect(readIntent("customer")).toBe("customer");
    expect(readIntent("staff")).toBe("staff");
    expect(readIntent("admin")).toBeNull();
    expect(readIntent(null)).toBeNull();
  });
});
