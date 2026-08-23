// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { StaffAccessRequest } from "@/lib/storage/types";

const mocks = vi.hoisted(() => ({
  getApi: vi.fn(),
  callApi: vi.fn(),
  user: { uid: "customer-1" },
}));

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user, actualRole: "client" }),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, getApi: mocks.getApi, callApi: mocks.callApi };
});

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
  beforeEach(() => vi.clearAllMocks());
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

    expect(await screen.findByText("Pending approval")).toBeTruthy();
    expect(screen.getByText(/restaurant owner still needs to approve/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /request staff access/i })).toBeNull();
  });

  it("offers another request after rejection", async () => {
    mocks.getApi.mockResolvedValue({ request: request("rejected") });
    render(<StaffAccessStatus />);

    expect(await screen.findByText("Request rejected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request staff access again" })).toBeTruthy();
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

    expect(await screen.findByText("Pending approval")).toBeTruthy();
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
});
