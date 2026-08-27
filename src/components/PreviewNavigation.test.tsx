// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/storage/types";

const mocks = vi.hoisted(() => ({
  pathname: "/admin",
  replace: vi.fn(),
  auth: {
    actualRole: null as Role | null,
    role: null as Role | null,
    viewAs: null as Role | null,
    loading: true,
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("@/lib/auth/AuthProvider", () => ({ useAuth: () => mocks.auth }));

import PreviewNavigation from "@/components/PreviewNavigation";

describe("PreviewNavigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = "/admin";
    mocks.auth = { actualRole: null, role: null, viewAs: null, loading: true };
  });
  afterEach(cleanup);

  it("leaves an admin URL after restoring a customer preview", async () => {
    const view = render(<PreviewNavigation />);
    expect(mocks.replace).not.toHaveBeenCalled();

    // AuthProvider has now read the admin claim and restored the session value
    // `mamma-calories:view-as=client`, making client the effective UI role.
    mocks.auth = {
      actualRole: "admin",
      role: "client",
      viewAs: "client",
      loading: false,
    };
    view.rerender(<PreviewNavigation />);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/plan"));
  });
});
