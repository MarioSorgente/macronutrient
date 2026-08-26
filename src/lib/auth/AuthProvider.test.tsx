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

  it("updates a refreshed token without duplicating sign-in synchronization", async () => {
    await mount();
    const user = firebaseUser("refresh-user");

    await reportAuth(user);
    await waitFor(() => expect(syncCalls()).toHaveLength(1));
    await act(async () => mocks.tokenChanged?.(user));
    await waitFor(() =>
      expect(user.getIdTokenResult).toHaveBeenCalledTimes(2)
    );

    expect(syncCalls()).toHaveLength(1);
  });
});
