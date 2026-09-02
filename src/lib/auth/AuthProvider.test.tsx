// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";

const mocks = vi.hoisted(() => ({
  authChanged: undefined as ((user: User | null) => Promise<void>) | undefined,
  tokenChanged: undefined as ((user: User | null) => void) | undefined,
  callApi: vi.fn(),
}));

vi.mock("@/lib/firebaseEnv", () => ({
  RESTAURANT_ID: "restaurant-1",
  isFirebaseConfigured: () => true,
}));
vi.mock("@/lib/api", () => ({ callApi: mocks.callApi }));
vi.mock("@/lib/storage/firebaseAuth", () => ({ getAuthClient: () => ({}) }));
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (
    _auth: unknown,
    callback: (user: User | null) => Promise<void>
  ) => {
    mocks.authChanged = callback;
    return vi.fn();
  },
  onIdTokenChanged: (
    _auth: unknown,
    callback: (user: User | null) => void
  ) => {
    mocks.tokenChanged = callback;
    return vi.fn();
  },
  signOut: vi.fn(),
}));
vi.mock("@/lib/storage/firebaseClient", () => ({ getDb: () => ({}) }));
vi.mock("firebase/firestore", () => ({
  doc: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => vi.fn()),
}));

import { AuthProvider, useAuth } from "@/lib/auth/AuthProvider";

function Probe() {
  const auth = useAuth();
  return (
    <div
      data-testid="auth"
      data-uid={auth.user?.uid ?? "signed-out"}
      data-role={auth.actualRole ?? "none"}
      data-view-as={auth.viewAs ?? "none"}
      data-error={auth.syncError ?? "none"}
      data-loading={String(auth.loading)}
      data-effective-role={auth.role ?? "none"}
    />
  );
}

function firebaseUser(uid: string, role: "admin" | "client" = "client") {
  return {
    uid,
    getIdTokenResult: vi.fn(async () => ({
      claims: { role },
      authTime: "2026-08-26T00:00:00.000Z",
    })),
  } as unknown as User;
}

async function reportAuth(user: User | null) {
  await act(async () => {
    await mocks.authChanged?.(user);
  });
}

const syncCalls = () =>
  mocks.callApi.mock.calls.filter(([path]) => path === "/api/auth/sync");

describe("AuthProvider authentication events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authChanged = undefined;
    mocks.tokenChanged = undefined;
    mocks.callApi.mockResolvedValue({ role: "client", changed: false });
    window.sessionStorage.clear();
  });

  afterEach(cleanup);

  async function mount() {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(mocks.authChanged).toBeTypeOf("function"));
  }

  it("synchronizes again after external sign-out and same-user sign-in", async () => {
    await mount();
    const user = firebaseUser("same-user");

    await reportAuth(user);
    await waitFor(() => expect(syncCalls()).toHaveLength(1));

    await reportAuth(null);
    await reportAuth(user);
    await waitFor(() => expect(syncCalls()).toHaveLength(2));

    // The new sign-in is one event and therefore one reconciliation.
    await Promise.resolve();
    expect(syncCalls()).toHaveLength(2);
  });

  it("synchronizes once for each account when the signed-in account changes", async () => {
    await mount();

    await reportAuth(firebaseUser("account-a"));
    await waitFor(() => expect(syncCalls()).toHaveLength(1));
    await reportAuth(firebaseUser("account-b"));
    await waitFor(() => expect(syncCalls()).toHaveLength(2));

    expect(syncCalls()).toHaveLength(2);
  });

  /**
   * The failure mode this guards is total and silent: `readRole` is awaited
   * immediately before `loading` is cleared, so an unguarded rejection left the
   * whole app on "Checking your access..." for the rest of the session, on every
   * protected route. It looks exactly like a hung page and only a reload escapes.
   */
  it("still finishes loading when the ID token cannot be read", async () => {
    await mount();
    const broken = {
      uid: "offline-user",
      getIdTokenResult: vi.fn(async () => {
        throw new Error("auth/network-request-failed");
      }),
    } as unknown as User;

    await reportAuth(broken);

    const probe = document.querySelector("[data-testid=auth]");
    await waitFor(() => expect(probe?.getAttribute("data-loading")).toBe("false"));
    expect(probe?.getAttribute("data-uid")).toBe("offline-user");
    // The server is still asked, so a role can arrive despite the bad token.
    await waitFor(() => expect(syncCalls()).toHaveLength(1));
  });

  /**
   * The admin preview used to be restored by an effect that could not win: it
   * ran only once the role landed, and it sits above RouteGuard, so the guard
   * saw a bare admin on a customer page and redirected before the preview came
   * back. Reading it at mount is what makes a refresh keep the preview.
   */
  it("has the saved admin preview in hand on the render the role arrives", async () => {
    window.sessionStorage.setItem("mamma-calories:view-as", "client");
    mocks.callApi.mockResolvedValue({ role: "admin", changed: false });
    await mount();

    await reportAuth(firebaseUser("owner", "admin"));

    const probe = document.querySelector("[data-testid=auth]");
    await waitFor(() => expect(probe?.getAttribute("data-role")).toBe("admin"));
    // Never "admin" in between: that intermediate value is what caused the bounce.
    expect(probe?.getAttribute("data-effective-role")).toBe("client");
    expect(probe?.getAttribute("data-view-as")).toBe("client");
  });

  it("ignores a saved preview belonging to somebody who is not an admin", async () => {
    window.sessionStorage.setItem("mamma-calories:view-as", "restaurant");
    await mount();

    await reportAuth(firebaseUser("diner", "client"));

    const probe = document.querySelector("[data-testid=auth]");
    await waitFor(() => expect(probe?.getAttribute("data-role")).toBe("client"));
    expect(probe?.getAttribute("data-view-as")).toBe("none");
    expect(probe?.getAttribute("data-effective-role")).toBe("client");
  });

  it("updates a refreshed token without duplicating sign-in synchronization", async () => {
    await mount();
    const user = firebaseUser("refresh-user");

    await reportAuth(user);
    await waitFor(() => expect(syncCalls()).toHaveLength(1));
    const beforeRefresh = (user.getIdTokenResult as ReturnType<typeof vi.fn>).mock.calls.length;

    await act(async () => mocks.tokenChanged?.(user));
    await waitFor(() =>
      expect((user.getIdTokenResult as ReturnType<typeof vi.fn>).mock.calls.length)
        .toBe(beforeRefresh + 1)
    );

    // The point: a token refresh re-reads the claim, and does not reconcile again.
    expect(syncCalls()).toHaveLength(1);
  });

  /**
   * The role the app acts on has to be one its token can prove.
   *
   * `runSync` used to refresh only when the server reported `changed`, and set
   * the role from the server's answer either way. An account granted admin on an
   * earlier call, whose next page load raced that refresh, was told "admin" with
   * `changed: false` — and then sent every admin-only request with a token still
   * claiming "client". The server answered 403 to a screen that had already
   * decided the viewer was the owner.
   */
  it("refreshes the token when the server reports a role the token does not carry", async () => {
    mocks.callApi.mockResolvedValue({ role: "admin", changed: false });
    await mount();
    // The token still says client; only the server knows about the grant.
    const user = firebaseUser("late-owner", "client");

    await reportAuth(user);

    await waitFor(() => expect(user.getIdTokenResult).toHaveBeenCalledWith(true));
    const probe = document.querySelector("[data-testid=auth]");
    await waitFor(() => expect(probe?.getAttribute("data-role")).toBe("admin"));
  });
});
