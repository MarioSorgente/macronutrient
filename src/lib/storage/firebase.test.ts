import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collection: vi.fn(),
  setDoc: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  collection: mocks.collection,
  deleteDoc: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: mocks.getDocs,
  limit: mocks.limit,
  orderBy: mocks.orderBy,
  query: mocks.query,
  setDoc: mocks.setDoc,
}));

vi.mock("@/lib/storage/firebaseClient", () => ({ getDb: mocks.getDb }));

import { createFirestoreRepository } from "@/lib/storage/firebase";
import type { Entity } from "@/lib/storage/types";

describe("Firestore repository latest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue("database");
    mocks.collection.mockReturnValue("collection");
    mocks.orderBy.mockReturnValue("descending-update-order");
    mocks.limit.mockReturnValue("one-document-limit");
    mocks.query.mockReturnValue("latest-query");
  });

  it("returns null for an empty collection", async () => {
    mocks.getDocs.mockResolvedValue({ docs: [] });
    const repo = createFirestoreRepository<Entity>("users/u1/plans");

    await expect(repo.latest()).resolves.toBeNull();
  });

  it("orders newest first and limits the query to one document", async () => {
    const newest = {
      id: "newest",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    };
    mocks.getDocs.mockResolvedValue({ docs: [{ data: () => newest }] });
    const repo = createFirestoreRepository<Entity>("users/u1/plans");

    await expect(repo.latest()).resolves.toEqual(newest);
    expect(mocks.collection).toHaveBeenCalledWith("database", "users/u1/plans");
    expect(mocks.orderBy).toHaveBeenCalledWith("updatedAt", "desc");
    expect(mocks.limit).toHaveBeenCalledWith(1);
    expect(mocks.query).toHaveBeenCalledWith(
      "collection",
      "descending-update-order",
      "one-document-limit"
    );
    expect(mocks.getDocs).toHaveBeenCalledWith("latest-query");
  });
});

/**
 * Firestore rejects a write containing `undefined` outright, while the
 * localStorage backend drops those keys through JSON. The app writes
 * `notes: value || undefined` and similar in several places, so the same record
 * saved fine on one backend and failed on the other — which is what made "Save
 * settings" report that it could not save your plan.
 */
describe("Firestore repository save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue("database");
    mocks.setDoc.mockResolvedValue(undefined);
  });

  type Record_ = Entity & Record<string, unknown>;
  const stamps = {
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
  const record = (over: Record<string, unknown>): Record_ =>
    ({ id: "primary", ...stamps, ...over }) as Record_;
  const repo = () => createFirestoreRepository<Record_>("users/u1/plans");
  const saved = () => mocks.setDoc.mock.calls[0][1] as Record<string, unknown>;

  it("drops undefined fields instead of failing the write", async () => {
    await repo().save(record({ name: "My week", notes: undefined }));

    expect(saved()).toEqual({ id: "primary", ...stamps, name: "My week" });
    expect("notes" in saved()).toBe(false);
  });

  it("drops them at any depth, including inside arrays", async () => {
    await repo().save(
      record({
        assignments: [{ id: "a1", dishId: undefined, servings: 2 }],
        preferences: { macroStyle: undefined, avoid: ["peanut"] },
      })
    );

    expect(saved()).toEqual({
      id: "primary",
      ...stamps,
      assignments: [{ id: "a1", servings: 2 }],
      preferences: { avoid: ["peanut"] },
    });
  });

  // null is a value Firestore stores happily, and the app uses it to mean
  // "explicitly cleared" — plan targets being the case that matters.
  it("keeps null, which means something different from absent", async () => {
    await repo().save(record({ targets: null }));

    expect(saved()).toEqual({ id: "primary", ...stamps, targets: null });
  });

  it("hands the caller back the record it passed in", async () => {
    const entity = record({ notes: undefined });

    expect(await repo().save(entity)).toBe(entity);
  });
});
