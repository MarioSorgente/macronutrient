// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/storage/types";

const mocks = vi.hoisted(() => ({
  role: "client" as Role,
  pathname: "/",
  user: {
    uid: "u1",
    displayName: "Test User",
    email: "test@example.com",
  },
  signOut: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
}));
vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: mocks.user,
    role: mocks.role,
    loading: false,
    enabled: true,
    signOut: mocks.signOut,
  }),
  isStaff: (role: Role | null) => role === "restaurant" || role === "admin",
}));
vi.mock("@/components/ViewAsSwitch", () => ({ default: () => <p>View as switch</p> }));

import AccountMenu from "@/components/AccountMenu";
import BrandHeader from "@/components/BrandHeader";

function openAccountMenu() {
  render(<AccountMenu />);
  fireEvent.click(screen.getByRole("button", { name: /account:/i }));
}

describe("customer navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = "client";
    mocks.pathname = "/";
  });
  afterEach(cleanup);

  it.each([
    ["client", true],
    ["restaurant", false],
    ["admin", false],
  ] as const)("filters header customer links for the %s role", (role, visible) => {
    mocks.role = role;
    render(<BrandHeader />);

    expect(Boolean(screen.queryByRole("link", { name: "Plan & Build" }))).toBe(visible);
    expect(Boolean(screen.queryByRole("link", { name: "My orders" }))).toBe(visible);
  });

  it.each([
    ["client", true],
    ["restaurant", false],
    ["admin", false],
  ] as const)("filters account-menu customer links for the %s role", (role, visible) => {
    mocks.role = role;
    openAccountMenu();

    expect(Boolean(screen.queryByRole("menuitem", { name: /my week/i }))).toBe(visible);
    expect(Boolean(screen.queryByRole("menuitem", { name: /my orders/i }))).toBe(visible);
  });

  it("uses an administrator's effective View as role in both navigation surfaces", () => {
    // AuthProvider exposes the preview role as `role`; an admin viewing as a
    // client should see exactly the customer navigation, while restaurant
    // preview should hide it.
    mocks.role = "client";
    const header = render(<BrandHeader />);
    expect(screen.getByRole("link", { name: "Plan & Build" })).toBeTruthy();
    header.unmount();

    openAccountMenu();
    expect(screen.getByRole("menuitem", { name: /my week/i })).toBeTruthy();
    cleanup();

    mocks.role = "restaurant";
    render(<BrandHeader />);
    expect(screen.queryByRole("link", { name: "Plan & Build" })).toBeNull();
    cleanup();
    openAccountMenu();
    expect(screen.queryByRole("menuitem", { name: /my week/i })).toBeNull();
  });
});
