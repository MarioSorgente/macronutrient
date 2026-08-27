import { describe, expect, it } from "vitest";
import { canManageHouseItems, canUseAdmin, canUseKitchen, homeForRole, roleLabel } from "./roles";

describe("roleLabel", () => {
  it.each([
    ["client", "Customer"],
    ["restaurant", "Staff"],
    ["admin", "Owner"],
  ] as const)("labels %s as %s", (role, label) => {
    expect(roleLabel(role)).toBe(label);
  });
});

describe("role capabilities", () => {
  it.each([
    ["client", false, false, false, "/plan"],
    ["restaurant", true, true, false, "/kitchen"],
    ["admin", false, true, true, "/admin"],
  ] as const)("encodes the %s role", (role, kitchen, houseItems, admin, home) => {
    expect(canUseKitchen(role)).toBe(kitchen);
    expect(canManageHouseItems(role)).toBe(houseItems);
    expect(canUseAdmin(role)).toBe(admin);
    expect(homeForRole(role)).toBe(home);
  });
});
