import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collection: vi.fn(),
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
  setDoc: vi.fn(),
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
    const repo = createFirestoreRepository<Entity>("plans");

    await expect(repo.latest()).resolves.toBeNull();
  });

  it("orders newest first and limits the query to one document", async () => {
    const newest = {
      id: "newest",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    };
    mocks.getDocs.mockResolvedValue({ docs: [{ data: () => newest }] });
    const repo = createFirestoreRepository<Entity>("plans");

    await expect(repo.latest()).resolves.toEqual(newest);
    expect(mocks.collection).toHaveBeenCalledWith("database", "plans");
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
