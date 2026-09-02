// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { Role, StaffAccessRequest } from "@/lib/storage/types";

const mocks = vi.hoisted(() => ({
  getApi: vi.fn(),
  callApi: vi.fn(),
  push: vi.fn(),
  syncAccount: vi.fn(),
  refreshRole: vi.fn(),
  sendEmailVerification: vi.fn(),
  user: { uid: "customer-1", email: "customer@example.com", emailVerified: true } as {
    uid: string;
    email: string;
    emailVerified: boolean;
  },
  actualRole: "client" as Role | null,
  roleSettled: true,
  viewAs: null as Role | null,
  setViewAs: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.push }),
}));
vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: mocks.user,
    actualRole: mocks.actualRole,
    roleSettled: mocks.roleSettled,
    viewAs: mocks.viewAs,
    setViewAs: mocks.setViewAs,
    syncAccount: mocks.syncAccount,
    refreshRole: mocks.refreshRole,
  }),
  isStaff: (role: Role | null) => role === "restaurant" || role === "admin",
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, getApi: mocks.getApi, callApi: mocks.callApi };
});
vi.mock("firebase/auth", () => ({
  sendEmailVerification: mocks.sendEmailVerification,
}));

import StaffAccessStatus from "@/components/StaffAccessStatus";

const request = (status: StaffAccessRequest["status"]): StaffAccessRequest => ({
  id: "customer-1",
  restaurantId: "restaurant-1",
  uid: "customer-1",
  email: "customer@example.com",
  emailVerified: true,
  status,
  createdAt: "2026-08-23T00:00:00.000Z",
});

describe("StaffAccessStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actualRole = "client";
    mocks.roleSettled = true;
    mocks.viewAs = null;
    mocks.user = {
      uid: "customer-1",
      email: "customer@example.com",
      emailVerified: true,
    };
    window.history.replaceState({}, "", "/account");
  });
  afterEach(cleanup);

  it("offers a first staff access request when there is no request", async () => {
    mocks.getApi.mockResolvedValue({ request: null });
    render(<StaffAccessStatus />);

    expect(await screen.findByText("Not requested")).toBeTruthy();
    expect(screen.getByText("Restaurant access")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request staff access" })).toBeTruthy();
  });

  it("explains a pending request without rendering another request button", async () => {
    mocks.getApi.mockResolvedValue({ request: request("pending") });
    render(<StaffAccessStatus />);

    expect(await screen.findByText("Waiting for owner approval")).toBeTruthy();
    expect(screen.getByText(/restaurant owner still needs to approve/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /request staff access/i })).toBeNull();
  });

  it("offers another request after rejection", async () => {
    mocks.getApi.mockResolvedValue({ request: request("rejected") });
    render(<StaffAccessStatus />);

    expect(await screen.findByText("Your previous request was not approved")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request again" })).toBeTruthy();
  });

  it("shows a safe load error and retries the GET", async () => {
    mocks.getApi
      .mockRejectedValueOnce(new Error("Firestore credentials: super-secret"))
      .mockResolvedValueOnce({ request: null });
    render(<StaffAccessStatus />);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "We couldn't check your restaurant access. Please try again."
    );
    expect(screen.queryByText(/super-secret/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Not requested")).toBeTruthy();
    expect(mocks.getApi).toHaveBeenCalledTimes(2);
  });

  it("POSTs and refreshes the displayed request after success", async () => {
    mocks.getApi
      .mockResolvedValueOnce({ request: null })
      .mockResolvedValueOnce({ request: request("pending") });
    let finishPost!: () => void;
    mocks.callApi.mockReturnValue(new Promise<void>((resolve) => { finishPost = resolve; }));
    render(<StaffAccessStatus />);

    const button = await screen.findByRole("button", { name: "Request staff access" });
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.callApi).toHaveBeenCalledWith("/api/staff/request-access");
    finishPost();

    expect(await screen.findByText("Waiting for owner approval")).toBeTruthy();
    expect(mocks.getApi).toHaveBeenCalledTimes(2);
  });

  it("shows a sanitized POST failure and re-enables the request control", async () => {
    mocks.getApi.mockResolvedValue({ request: null });
    mocks.callApi.mockRejectedValue(new ApiError(409, " <b>Request unavailable</b>\nnow "));
    render(<StaffAccessStatus />);

    fireEvent.click(await screen.findByRole("button", { name: "Request staff access" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Request unavailable now");
    await waitFor(() => expect(
      (screen.getByRole("button", { name: "Request staff access" }) as HTMLButtonElement).disabled
    ).toBe(false));
    expect(screen.queryByText(/<b>/)).toBeNull();
  });

  it("confirms the request a staff signup has just filed", async () => {
    window.history.replaceState({}, "", "/account?staff-requested=1");
    mocks.getApi.mockResolvedValue({ request: request("pending") });
    render(<StaffAccessStatus />);

    expect(await screen.findByText(/your request is with the restaurant owner/i)).toBeTruthy();
  });

  describe("once an owner has approved", () => {
    /**
     * The claim is on the account but not on this token yet, so the app still
     * reads `client`. Nobody should have to know that, let alone what a custom
     * claim is.
     */
    it("pulls the granted role onto the token without being asked", async () => {
      mocks.getApi.mockResolvedValue({ request: request("approved") });
      mocks.syncAccount.mockResolvedValue("restaurant");
      mocks.refreshRole.mockResolvedValue("restaurant");
      render(<StaffAccessStatus />);

      expect(await screen.findByText("Staff access approved")).toBeTruthy();
      await waitFor(() => expect(mocks.syncAccount).toHaveBeenCalledTimes(1));
      expect(mocks.refreshRole).toHaveBeenCalledTimes(1);
      // Automatic activation must not navigate: somebody reading /account did
      // not ask to be taken to the kitchen.
      expect(mocks.push).not.toHaveBeenCalled();
    });

    it("takes them to the kitchen when they press the button", async () => {
      mocks.getApi.mockResolvedValue({ request: request("approved") });
      mocks.syncAccount.mockResolvedValue("restaurant");
      mocks.refreshRole.mockResolvedValue("restaurant");
      render(<StaffAccessStatus />);

      fireEvent.click(await screen.findByRole("button", { name: "Activate staff access" }));
      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/kitchen"));
    });

    it("says so plainly when the grant has not actually landed", async () => {
      mocks.getApi.mockResolvedValue({ request: request("approved") });
      mocks.syncAccount.mockResolvedValue("client");
      mocks.refreshRole.mockResolvedValue("client");
      render(<StaffAccessStatus />);

      expect((await screen.findByRole("alert")).textContent).toMatch(/not active yet/i);
      expect(mocks.push).not.toHaveBeenCalled();
    });
  });

  describe("an unconfirmed address", () => {
    /**
     * Approval requires a verified address, and the requester used to be told
     * nothing about it — they sat in "pending" indefinitely while the owner
     * looked at a disabled Approve button.
     */
    it("is named as the thing blocking approval, with a way to fix it", async () => {
      mocks.user = { ...mocks.user, emailVerified: false };
      mocks.getApi.mockResolvedValue({ request: request("pending") });
      render(<StaffAccessStatus />);

      expect(
        await screen.findByText(/confirm your email before the restaurant owner/i)
      ).toBeTruthy();

      fireEvent.click(
        screen.getByRole("button", { name: "Send verification email again" })
      );
      await waitFor(() => expect(mocks.sendEmailVerification).toHaveBeenCalledTimes(1));
      expect(await screen.findByText(/verification email sent/i)).toBeTruthy();
    });

    it("is not raised once the request has been settled either way", async () => {
      mocks.user = { ...mocks.user, emailVerified: false };
      mocks.getApi.mockResolvedValue({ request: request("rejected") });
      render(<StaffAccessStatus />);

      expect(await screen.findByText("Your previous request was not approved")).toBeTruthy();
      expect(screen.queryByText(/confirm your email/i)).toBeNull();
    });
  });

  describe("as the whole page a customer gets instead of the kitchen", () => {
    it("names what is missing and offers the request", async () => {
      mocks.getApi.mockResolvedValue({ request: null });
      render(<StaffAccessStatus variant="gate" />);

      expect(
        await screen.findByRole("heading", { name: /restaurant staff access is required/i })
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Request staff access" })).toBeTruthy();
      // Not a dead end: there is still somewhere to go.
      expect(screen.getByRole("link", { name: /plan your own week/i })).toBeTruthy();
    });
  });

  it("renders no access card on the account page for somebody who already has access", () => {
    mocks.actualRole = "restaurant";
    const { container } = render(<StaffAccessStatus />);

    expect(container.textContent).toBe("");
    expect(mocks.getApi).not.toHaveBeenCalled();
  });

  /**
   * The gate is reached from the *effective* role and used to answer from the
   * *actual* one, so an owner previewing as a customer opened /kitchen and got a
   * completely blank page: the guard rendered this, and this returned null.
   * A preview is not a denial, and either way the page has to say something.
   */
  it("explains the preview instead of rendering a blank page", async () => {
    mocks.actualRole = "admin";
    mocks.viewAs = "client";
    render(<StaffAccessStatus variant="gate" />);

    expect(
      await screen.findByRole("heading", { name: /restaurant staff access is required/i })
    ).toBeTruthy();
    expect(screen.getByText(/previewing Mamma Calories as a customer/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Leave preview" }));
    expect(mocks.setViewAs).toHaveBeenCalledWith(null);
    // Still their own account: no staff request is offered or filed.
    expect(screen.queryByRole("button", { name: /request staff access/i })).toBeNull();
    expect(mocks.getApi).not.toHaveBeenCalled();
  });

  it("waits for the role to settle before asking the server about a request", () => {
    mocks.actualRole = null;
    mocks.roleSettled = false;
    render(<StaffAccessStatus />);

    // A fresh sign-up has no claim for its first frames. Asking then meant a
    // round trip whose answer the component immediately unmounted.
    expect(mocks.getApi).not.toHaveBeenCalled();
  });
});
