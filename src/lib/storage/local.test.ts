import { beforeEach, describe, expect, it } from "vitest";
import { createLocalRepository } from "@/lib/storage/local";
import type { Entity, Plan } from "@/lib/storage/types";

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

/**
 * The device round-trip a guest depends on: an applied week written here has to
 * come back whole after the page reloads and the repository is rebuilt.
 */
describe("a guest's plan on this device", () => {
  const week = (): Plan => ({
    id: "primary", createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z", ownerUid: "", title: "My week",
    targets: { energy_kcal: 2000, protein_g: 125, carbs_g: 225, fat_g: 66.7 },
    targetMode: "custom",
    mealSlots: ["Breakfast", "Lunch", "Dinner"], programStartDate: "2026-03-30",
    weekCount: 4, status: "draft", submittedWeeks: [],
    assignments: Array.from({ length: 21 }, (_, index) => ({
      id: `a${index}`, week: 1, day: index % 7, slot: "Lunch", servings: 1,
      items: [{ ingredientId: "chicken_breast_raw", name: "Chicken", grams: 150,
        unitId: "g", quantity: 150 }],
      price: { totalIdr: 30_000, complete: true },
      snapshot: { name: `meal ${index}`,
        totals: { energy_kcal: 600, protein_g: 50, carbs_g: 60, fat_g: 20, fiber_g: 3 } },
    })),
  });

  it("survives the repository being rebuilt, which is what a reload is", async () => {
    await createLocalRepository<Plan>("plans").save(week());
    const reloaded = await createLocalRepository<Plan>("plans").latest();

    expect(reloaded).toEqual(week());
    expect(reloaded?.assignments[0].items).toHaveLength(1);
    expect(reloaded?.targets?.energy_kcal).toBe(2000);
  });

  it("upserts by id rather than accumulating copies", async () => {
    const repo = createLocalRepository<Plan>("plans");
    await repo.save(week());
    await repo.save({ ...week(), updatedAt: "2026-04-02T00:00:00.000Z", title: "Renamed" });

    expect(await repo.list()).toHaveLength(1);
    expect((await repo.latest())?.title).toBe("Renamed");
  });

  it("does not let an undated record win latest() forever", async () => {
    // `latest()` reduces with `value > newest`, and every comparison against
    // undefined is false — so an undated record seeded first used to pin the
    // result to itself and hide every real plan behind it.
    const repo = createLocalRepository<Plan>("plans");
    const undated = { ...week(), id: "legacy" } as Plan;
    delete (undated as Partial<Plan>).updatedAt;
    await repo.save(undated);
    await repo.save({ ...week(), updatedAt: "2026-05-01T00:00:00.000Z", title: "Newer" });

    expect((await repo.latest())?.title).toBe("Newer");
  });
});
