import { beforeEach, describe, expect, it } from "vitest";
import { createLocalRepository } from "@/lib/storage/local";
import type { Entity } from "@/lib/storage/types";

interface TestEntity extends Entity {
  name: string;
}

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    },
  });
});

describe("local repository latest", () => {
  it("returns null for an empty collection", async () => {
    const repo = createLocalRepository<TestEntity>("entities");

    await expect(repo.latest()).resolves.toBeNull();
  });

  it("returns the newest entity without changing list semantics", async () => {
    const repo = createLocalRepository<TestEntity>("entities");
    const older = {
      id: "older",
      name: "Older",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    const newer = {
      id: "newer",
      name: "Newer",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    };

    await repo.save(older);
    await repo.save(newer);

    await expect(repo.latest()).resolves.toEqual(newer);
    await expect(repo.list()).resolves.toEqual([newer, older]);
  });
});
