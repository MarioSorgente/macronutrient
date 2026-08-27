// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/storage/types";

const mocks = vi.hoisted(() => ({
  pathname: "/admin",
  push: vi.fn(),
  setViewAs: vi.fn(),
  viewAs: null as Role | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
}));
vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({
    actualRole: "admin",
    viewAs: mocks.viewAs,
    setViewAs: mocks.setViewAs,
  }),
}));

import ViewAsSwitch from "@/components/ViewAsSwitch";

describe("ViewAsSwitch navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = "/admin";
    mocks.viewAs = null;
  });
  afterEach(cleanup);

  it("moves from the admin dashboard to a customer-valid page", () => {
    render(<ViewAsSwitch />);

    fireEvent.click(screen.getByRole("button", { name: "Customer" }));

    expect(mocks.setViewAs).toHaveBeenCalledWith("client");
    expect(mocks.push).toHaveBeenCalledWith("/plan");
  });

  it("returns an administrator to the admin landing page", () => {
    mocks.pathname = "/plan";
    mocks.viewAs = "client";
    render(<ViewAsSwitch />);

    fireEvent.click(screen.getByRole("button", { name: "Owner" }));

    expect(mocks.setViewAs).toHaveBeenCalledWith(null);
    expect(mocks.push).toHaveBeenCalledWith("/admin");
  });
});
