import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRIMARY_PLAN_ID,
  __resetPlanCache,
  lastKnownPlan,
  loadCurrentPlan,
  newPlan,
  savePlan,
  whenPlanWritesSettle,
} from "@/lib/currentPlan";
import type { Plan, PlanRepository } from "@/lib/storage/types";

/**
 * The load-edit-save-reload cycle, which was untested at every level while
 * being the thing that lost people's weeks.
 *
 * Two faults are guarded here. Writes were unordered and unobserved, so an
 * older plan could land after a newer one and a failure was invisible. And an
 * empty read was treated as licence to create: `newPlan()` goes to the fixed
 * `primary` id and both backends save by full replacement, so one bad read
 * destroyed the real plan rather than merely failing to find it.
 */

interface FakeRepo extends PlanRepository {
  readonly saved: Plan[];
  readonly calls: string[];
  store: Map<string, Plan>;
  failNextSave: Error | null;
  /** When set, `save` waits for this before resolving. */
  hold: Promise<void> | null;
}

function fakeRepository(seed: Plan[] = []): FakeRepo {
  const saved: Plan[] = [];
  const calls: string[] = [];
  const store = new Map(seed.map((plan) => [plan.id, plan]));
  const repo: FakeRepo = {
    saved, calls, store, failNextSave: null, hold: null,
    async list() { calls.push("list"); return [...store.values()]; },
    async latest() {
      calls.push("latest");
      return [...store.values()].reduce<Plan | null>((newest, plan) =>
        !newest || plan.updatedAt > newest.updatedAt ? plan : newest, null);
    },
    async get(id) { calls.push(`get:${id}`); return store.get(id) ?? null; },
    async save(plan) {
      calls.push(`save:${plan.id}`);
      if (repo.hold) await repo.hold;
      if (repo.failNextSave) {
        const failure = repo.failNextSave;
        repo.failNextSave = null;
        throw failure;
      }
      saved.push(plan);
      store.set(plan.id, plan);
      return plan;
    },
    async remove(id) { store.delete(id); },
  };
  return repo;
}

const planWith = (assignments: number, updatedAt: string): Plan => ({
  ...newPlan("u1"),
  updatedAt,
  assignments: Array.from({ length: assignments }, (_, index) => ({
    id: `a${index}`, week: 1, day: index, slot: "Lunch", servings: 1, items: [],
    snapshot: { name: `meal ${index}`,
      totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 } },
  })),
});

afterEach(() => {
  __resetPlanCache();
  vi.useRealTimers();
});

describe("saving a plan", () => {
  it("serialises writes so an older plan cannot land after a newer one", async () => {
    const repo = fakeRepository();
    let release!: () => void;
    repo.hold = new Promise<void>((resolve) => { release = () => resolve(); });

    const first = savePlan(repo, "u1", planWith(1, "2026-01-01T00:00:00.000Z"));
    const second = savePlan(repo, "u1", planWith(2, "2026-01-02T00:00:00.000Z"));

    // The second write has not been issued while the first is outstanding.
    expect(repo.saved).toHaveLength(0);
    repo.hold = null;
    release();
    await Promise.all([first, second]);

    expect(repo.saved.map((plan) => plan.assignments.length)).toEqual([1, 2]);
    expect(lastKnownPlan("u1")?.assignments).toHaveLength(2);
  });

  it("stamps updatedAt, because neither repository does it for you", async () => {
    const repo = fakeRepository();
    const stale = { ...planWith(1, "2020-01-01T00:00:00.000Z") };
    const stored = await savePlan(repo, "u1", stale);

    expect(stored.updatedAt > stale.updatedAt).toBe(true);
    expect(repo.saved[0].updatedAt).toBe(stored.updatedAt);
  });

  it("reports a failed write instead of swallowing it", async () => {
    const repo = fakeRepository();
    repo.failNextSave = new Error("offline");

    await expect(savePlan(repo, "u1", planWith(3, "2026-01-01T00:00:00.000Z")))
      .rejects.toThrow("offline");
    // The week is not lost: this session still holds the only copy of it.
    expect(lastKnownPlan("u1")?.assignments).toHaveLength(3);
    // And the queue is still usable rather than a poisoned rejected promise.
    await expect(whenPlanWritesSettle("u1")).resolves.toBeUndefined();
  });

  it("keeps owners apart", async () => {
    const repo = fakeRepository();
    await savePlan(repo, "u1", planWith(1, "2026-01-01T00:00:00.000Z"));
    await savePlan(repo, null, planWith(5, "2026-01-01T00:00:00.000Z"));

    expect(lastKnownPlan("u1")?.assignments).toHaveLength(1);
    expect(lastKnownPlan(null)?.assignments).toHaveLength(5);
    expect(lastKnownPlan("u2")).toBeNull();
  });
});

describe("loading the current plan", () => {
  it("rebases an empty August 17 draft to the current Bali week", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T04:00:00.000Z"));
    const oldDraft = { ...planWith(0, "2026-08-17T00:00:00.000Z"), programStartDate: "2026-08-17" };
    const repo = fakeRepository([oldDraft]);

    const loaded = await loadCurrentPlan(repo, "u1");

    expect(loaded.programStartDate).toBe("2026-08-24");
    expect(repo.saved.at(-1)?.programStartDate).toBe("2026-08-24");
  });

  it("does not silently rebase a populated August 17 plan", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T04:00:00.000Z"));
    const populated = { ...planWith(1, "2026-08-17T00:00:00.000Z"), programStartDate: "2026-08-17" };
    const repo = fakeRepository([populated]);

    expect((await loadCurrentPlan(repo, "u1")).programStartDate).toBe("2026-08-17");
    expect(repo.saved).toEqual([]);
  });

  it("uses Bali's date at the UTC midnight boundary, with Sunday in the preceding week", async () => {
    vi.useFakeTimers();
    // Sunday 16:30 UTC is already Monday just after midnight in Bali.
    vi.setSystemTime(new Date("2026-08-23T16:30:00.000Z"));
    const mondayRepo = fakeRepository([{ ...planWith(0, "2026-08-17T00:00:00.000Z"), programStartDate: "2026-08-17" }]);
    expect((await loadCurrentPlan(mondayRepo, "u1")).programStartDate).toBe("2026-08-24");

    __resetPlanCache();
    // One minute before Bali midnight is still Sunday, hence the Aug 17 week.
    vi.setSystemTime(new Date("2026-08-23T15:59:00.000Z"));
    const sundayRepo = fakeRepository([{ ...planWith(0, "2026-08-17T00:00:00.000Z"), programStartDate: "2026-08-17" }]);
    expect((await loadCurrentPlan(sundayRepo, "u1")).programStartDate).toBe("2026-08-17");
    expect(sundayRepo.saved).toEqual([]);
  });

  it("waits for a write in flight before reading", async () => {
    const repo = fakeRepository();
    let release!: () => void;
    repo.hold = new Promise<void>((resolve) => { release = () => resolve(); });

    const saving = savePlan(repo, "u1", planWith(21, "2026-02-01T00:00:00.000Z"));
    const loading = loadCurrentPlan(repo, "u1");
    await Promise.resolve();

    // This is the tab-switch race: without the barrier the read runs first and
    // returns the pre-apply document.
    expect(repo.calls).not.toContain("latest");
    repo.hold = null;
    release();
    await saving;

    expect((await loading).assignments).toHaveLength(21);
    expect(repo.calls).toContain("latest");
  });

  it("prefers what this session wrote over an older stored copy", async () => {
    const repo = fakeRepository([planWith(1, "2026-01-01T00:00:00.000Z")]);
    await savePlan(repo, "u1", planWith(21, "2026-03-01T00:00:00.000Z"));
    // The store now holds both; the read must not resurrect the old one.
    repo.store.set("stale", planWith(1, "2026-01-01T00:00:00.000Z"));

    expect((await loadCurrentPlan(repo, "u1")).assignments).toHaveLength(21);
  });

  it("returns the week even when its save failed", async () => {
    const repo = fakeRepository([planWith(1, "2026-01-01T00:00:00.000Z")]);
    repo.failNextSave = new Error("offline");
    await expect(savePlan(repo, "u1", planWith(21, "2026-03-01T00:00:00.000Z")))
      .rejects.toThrow();

    // Reverting to the stored copy here is what made the week look like it had
    // vanished; the unsaved one is the only copy that exists.
    expect((await loadCurrentPlan(repo, "u1")).assignments).toHaveLength(21);
  });

  it("dedupes concurrent loads", async () => {
    const repo = fakeRepository([planWith(2, "2026-01-01T00:00:00.000Z")]);
    const [a, b] = await Promise.all([
      loadCurrentPlan(repo, "u1"), loadCurrentPlan(repo, "u1"),
    ]);

    expect(a).toBe(b);
    expect(repo.calls.filter((call) => call === "latest")).toHaveLength(1);
  });
});

describe("never overwriting a plan that is already there", () => {
  it("asks for the known id when the ordered read comes back empty", async () => {
    // A record with no updatedAt is invisible to `orderBy("updatedAt")`, so
    // `latest()` reports null while the document is sitting right there.
    const repo = fakeRepository();
    const invisible = { ...planWith(21, "2026-01-01T00:00:00.000Z"), id: PRIMARY_PLAN_ID };
    repo.store.set(PRIMARY_PLAN_ID, invisible);
    repo.latest = async () => { repo.calls.push("latest"); return null; };

    const loaded = await loadCurrentPlan(repo, "u1");

    expect(loaded.assignments).toHaveLength(21);
    expect(repo.calls).toContain(`get:${PRIMARY_PLAN_ID}`);
    expect(repo.saved, "must not write an empty plan over the real one").toEqual([]);
  });

  it("does not create when this session already knows the plan", async () => {
    const repo = fakeRepository();
    await savePlan(repo, "u1", planWith(21, "2026-03-01T00:00:00.000Z"));
    // An offline read is served from an empty cache and resolves null.
    repo.latest = async () => null;
    repo.get = async () => null;

    const loaded = await loadCurrentPlan(repo, "u1");

    expect(loaded.assignments).toHaveLength(21);
    expect(repo.saved).toHaveLength(1);
  });

  it("still creates a first plan when there genuinely is nothing", async () => {
    const repo = fakeRepository();
    const created = await loadCurrentPlan(repo, "u1");

    expect(created.id).toBe(PRIMARY_PLAN_ID);
    expect(created.ownerUid).toBe("u1");
    expect(created.assignments).toEqual([]);
    expect(repo.saved).toHaveLength(1);
  });
});
