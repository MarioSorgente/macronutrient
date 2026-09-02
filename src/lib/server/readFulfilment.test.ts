import { describe, expect, it } from "vitest";
import { readFulfilment } from "@/lib/server/orders";
import { buildOrderDays, fulfilmentProblems } from "@/lib/orders";
import type { Plan } from "@/lib/storage/types";

/**
 * What the server does with a fulfilment choice it cannot read.
 *
 * It used to skip it. That sounds defensive and was the opposite:
 * `buildOrderDays` falls back to DEFAULT_FULFILMENT for a day it has no choice
 * for, and that default is a pickup at noon. So a customer who chose delivery
 * with a time the server would not accept got a pickup order, their address
 * silently discarded, a 200, and a toast saying the week was with the kitchen.
 * `fulfilmentProblems` could not catch it either, because it only requires an
 * address of a day whose mode is "delivery" -- and the mode had just been
 * changed out from under it.
 *
 * The client gate was the loosest of the three HH:MM checks in the codebase, so
 * the gap was reachable rather than theoretical.
 */

const plan = {
  id: "p1", createdAt: "", updatedAt: "", ownerUid: "u1", title: "My week",
  targets: null, targetMode: "preset" as const, mealSlots: ["Lunch"],
  programStartDate: "2026-08-24", weekCount: 4, status: "draft" as const,
  submittedWeeks: [],
  assignments: [{
    id: "a1", week: 1, day: 0, slot: "Lunch", servings: 1,
    items: [], snapshot: { name: "Meal", totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 } },
  }],
} as unknown as Plan;

describe("readFulfilment", () => {
  it("keeps a well-formed delivery whole", () => {
    expect(readFulfilment({ 0: { mode: "delivery", time: "18:30", address: " Jl. Raya 1 " } }))
      .toEqual({ 0: { mode: "delivery", time: "18:30", address: "Jl. Raya 1" } });
  });

  it("accepts an absent choice, which is simply a day with no preference", () => {
    expect(readFulfilment(undefined)).toEqual({});
    expect(readFulfilment(null)).toEqual({});
  });

  it.each([
    ["a time no clock has", { 0: { mode: "delivery", time: "99:99", address: "Jl. Raya 1" } }],
    ["a time in the wrong shape", { 0: { mode: "delivery", time: "6pm", address: "Jl. Raya 1" } }],
    ["a mode that is neither", { 0: { mode: "teleport", time: "12:00" } }],
    ["a day off the end of the week", { 9: { mode: "pickup", time: "12:00" } }],
  ])("refuses %s rather than dropping it", (_label, payload) => {
    expect(() => readFulfilment(payload)).toThrowError();
  });

  /**
   * The consequence, spelled out: this is what silently shipped before, and it
   * is why dropping was the wrong answer.
   */
  it("would otherwise have become a pickup at noon with no address", () => {
    const dropped = {}; // what the old `continue` produced for a bad delivery
    const days = buildOrderDays(plan, 1, new Map(), dropped);

    expect(days[0].fulfilment).toEqual({ mode: "pickup", time: "12:00" });
    // And nothing downstream objects, because it is a valid pickup now.
    expect(fulfilmentProblems(days)).toEqual([]);
  });
});
