import { describe, expect, it } from "vitest";
import { roleLabel } from "./roles";

describe("roleLabel", () => {
  it.each([
    ["client", "Customer"],
    ["restaurant", "Staff"],
    ["admin", "Owner"],
  ] as const)("labels %s as %s", (role, label) => {
    expect(roleLabel(role)).toBe(label);
  });
});
