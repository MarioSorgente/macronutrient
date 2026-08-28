import { beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "@/lib/server/firebaseAdmin";
import { setPrepTaskStatus, type PrepStatusInput } from "@/lib/server/prepTasks";
import { RID, docAt, resetEmulators } from "./serverHarness";

const PATH = `restaurants/${RID}/prepTasks/t1`;
const staff = { uid: "cook", role: "restaurant", rid: RID };

async function seedTask(over: Record<string, unknown> = {}) {
  await adminDb().doc(`restaurants/${RID}/orders/o1`).set({
    id: "o1", restaurantId: RID, status: "accepted",
  });
  await adminDb().doc(PATH).set({
    id: "t1",
    restaurantId: RID,
    orderId: "o1",
    userId: "customer",
    status: "todo",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...over,
  });
}

beforeEach(resetEmulators);

describe("server prep-task lifecycle", () => {
  it("allows every edge in todo → prepping → ready → done", async () => {
    await seedTask();
    for (const status of ["prepping", "ready", "done"] as const) {
      await expect(setPrepTaskStatus(staff, { taskId: "t1", status }))
        .resolves.toMatchObject({ taskId: "t1", status });
      expect(await docAt(PATH)).toMatchObject({ status });
    }
  });

  it.each([
    ["todo", "ready"],
    ["todo", "done"],
    ["prepping", "done"],
  ] as const)("rejects the skipped %s → %s transition", async (from, status) => {
    await seedTask({ status: from });
    await expect(setPrepTaskStatus(staff, { taskId: "t1", status }))
      .rejects.toMatchObject({ status: 409 });
    expect(await docAt(PATH)).toMatchObject({ status: from });
  });

  it.each(["todo", "prepping", "ready"] as const)(
    "does not reopen done work as %s",
    async (status) => {
      await seedTask({ status: "done", doneAt: "original", doneByUid: "first-cook" });
      await expect(setPrepTaskStatus(staff, { taskId: "t1", status }))
        .rejects.toMatchObject({ status: 409 });
      expect(await docAt(PATH)).toMatchObject({
        status: "done", doneAt: "original", doneByUid: "first-cook",
      });
    }
  );

  it("makes identical concurrent transitions idempotent", async () => {
    await seedTask();
    const outcomes = await Promise.all([
      setPrepTaskStatus(staff, { taskId: "t1", status: "prepping" }),
      setPrepTaskStatus(staff, { taskId: "t1", status: "prepping" }),
    ]);
    expect(outcomes.filter((result) => result.unchanged)).toHaveLength(1);
    expect(await docAt(PATH)).toMatchObject({ status: "prepping" });
  });

  it("rejects cross-restaurant staff and a mismatched stored restaurant", async () => {
    await seedTask();
    await expect(setPrepTaskStatus(
      { uid: "outsider", role: "restaurant", rid: "elsewhere" },
      { taskId: "t1", status: "prepping" }
    )).rejects.toMatchObject({ status: 403 });

    await seedTask({ restaurantId: "elsewhere" });
    await expect(setPrepTaskStatus(staff, { taskId: "t1", status: "prepping" }))
      .rejects.toMatchObject({ status: 403 });
  });

  it("rejects a signed-in caller who is not restaurant staff", async () => {
    await seedTask();
    await expect(setPrepTaskStatus(
      { uid: "customer", role: "client", rid: RID },
      { taskId: "t1", status: "prepping" }
    )).rejects.toMatchObject({ status: 403 });
  });

  it("ignores forged audit fields and stamps completion itself", async () => {
    await seedTask({ status: "ready" });
    const forged = {
      taskId: "t1",
      status: "done",
      updatedAt: "forged",
      doneAt: "forged",
      doneByUid: "attacker",
    } as PrepStatusInput;
    await setPrepTaskStatus(staff, forged);

    const task = await docAt(PATH);
    expect(task).toMatchObject({ status: "done", doneByUid: staff.uid });
    expect(task?.updatedAt).not.toBe("forged");
    expect(task?.doneAt).toBe(task?.updatedAt);
    expect(Number.isFinite(Date.parse(String(task?.doneAt)))).toBe(true);
  });

  it("does not rewrite completion audit fields on a repeated request", async () => {
    await seedTask({ status: "done", doneAt: "original", doneByUid: "first-cook" });
    await expect(setPrepTaskStatus(staff, { taskId: "t1", status: "done" }))
      .resolves.toMatchObject({ unchanged: true });
    expect(await docAt(PATH)).toMatchObject({ doneAt: "original", doneByUid: "first-cook" });
  });

  it("returns 404 for a missing task", async () => {
    await expect(setPrepTaskStatus(staff, { taskId: "missing", status: "prepping" }))
      .rejects.toMatchObject({ status: 404 });
  });
});
