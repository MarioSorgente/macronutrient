import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * readStoredProfile exists because of one specific failure, so that failure is
 * what these tests describe: a read answered from AuthProvider's in-flight
 * sign-in stamp returns only that write's fields, and seeding a form from it
 * silently blanks the person's phone number and address.
 */

const mocks = vi.hoisted(() => ({
  getDocFromServer: vi.fn(),
  getDoc: vi.fn(),
  doc: vi.fn(() => ({ path: "users/u1" })),
  getDb: vi.fn(() => ({})),
}));

vi.mock("firebase/firestore", () => ({
  doc: mocks.doc,
  getDoc: mocks.getDoc,
  getDocFromServer: mocks.getDocFromServer,
}));
vi.mock("@/lib/storage/firebaseClient", () => ({ getDb: mocks.getDb }));

const { readStoredProfile } = await import("@/lib/auth/profile");

/** A snapshot shaped the way the Firestore SDK returns one. */
function snapshot(
  data: Record<string, unknown> | null,
  { hasPendingWrites = false } = {}
) {
  return {
    exists: () => data !== null,
    data: () => data ?? undefined,
    metadata: { hasPendingWrites, fromCache: false },
  };
}

/** Exactly what AuthProvider's sign-in stamp contributes, and nothing else. */
const PENDING_STAMP = {
  uid: "u1",
  email: "m@example.com",
  displayName: "Mario",
  lastLoginAt: "2026-08-22T00:00:00.000Z",
  loginCount: 3,
  updatedAt: "2026-08-22T00:00:00.000Z",
};

const SETTLED = {
  ...PENDING_STAMP,
  phone: "+62 812 3456 7890",
  defaultAddress: "Jl. Raya Canggu 1",
  role: "client",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("readStoredProfile", () => {
  it("returns the stored fields when nothing is pending", async () => {
    mocks.getDocFromServer.mockResolvedValue(snapshot(SETTLED));
    await expect(readStoredProfile("u1")).resolves.toEqual({
      displayName: "Mario",
      phone: "+62 812 3456 7890",
      defaultAddress: "Jl. Raya Canggu 1",
    });
    expect(mocks.getDocFromServer).toHaveBeenCalledTimes(1);
  });

  it("waits out a pending sign-in stamp rather than seeding a form from it", async () => {
    // The bug: the first read is the latency-compensated view of the stamp,
    // which has no phone in it at all.
    mocks.getDocFromServer
      .mockResolvedValueOnce(snapshot(PENDING_STAMP, { hasPendingWrites: true }))
      .mockResolvedValueOnce(snapshot(PENDING_STAMP, { hasPendingWrites: true }))
      .mockResolvedValue(snapshot(SETTLED));

    const profile = await readStoredProfile("u1");
    expect(profile?.phone).toBe("+62 812 3456 7890");
    expect(mocks.getDocFromServer).toHaveBeenCalledTimes(3);
  });

  it("gives up after a bounded number of attempts instead of hanging", async () => {
    mocks.getDocFromServer.mockResolvedValue(
      snapshot(PENDING_STAMP, { hasPendingWrites: true })
    );
    const profile = await readStoredProfile("u1");
    // Returns the best view it had rather than throwing or looping forever.
    expect(profile).toEqual({
      displayName: "Mario",
      phone: undefined,
      defaultAddress: undefined,
    });
    expect(mocks.getDocFromServer.mock.calls.length).toBeLessThanOrEqual(12);
    expect(mocks.getDocFromServer.mock.calls.length).toBeGreaterThan(1);
  });

  it("returns null when the profile document does not exist", async () => {
    mocks.getDocFromServer.mockResolvedValue(snapshot(null));
    await expect(readStoredProfile("u1")).resolves.toBeNull();
  });

  it("falls back to the cached read when the server is unreachable", async () => {
    mocks.getDocFromServer.mockRejectedValue(new Error("offline"));
    mocks.getDoc.mockResolvedValue(snapshot(SETTLED));
    await expect(readStoredProfile("u1")).resolves.toMatchObject({
      phone: "+62 812 3456 7890",
    });
    expect(mocks.getDoc).toHaveBeenCalled();
  });

  it("ignores a non-string field rather than putting it in an input", async () => {
    mocks.getDocFromServer.mockResolvedValue(
      snapshot({ displayName: 42, phone: null, defaultAddress: { a: 1 } })
    );
    await expect(readStoredProfile("u1")).resolves.toEqual({
      displayName: undefined,
      phone: undefined,
      defaultAddress: undefined,
    });
  });
});
