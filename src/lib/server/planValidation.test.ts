import { describe, expect, it } from "vitest";
import { validatePlanSchedule } from "@/lib/server/planValidation";
import { MAX_PROGRAM_WEEKS } from "@/lib/storage/types";

const schedule = { weekCount: 2, programStartDate: "2026-08-24" };

function rejects(plan: unknown, week: number, message: string): void {
  expect(() => validatePlanSchedule(plan, week)).toThrow(message);
}

describe("validatePlanSchedule", () => {
  it("rejects week zero and weeks above the plan's week count", () => {
    rejects(schedule, 0, "requested week is outside the program");
    rejects(schedule, 3, "requested week is outside the program");
  });

  it("rejects an excessive plan week count", () => {
    rejects({ ...schedule, weekCount: MAX_PROGRAM_WEEKS + 1 }, 1, "week count is invalid");
  });

  it("rejects malformed and impossible program start dates", () => {
    rejects({ ...schedule, programStartDate: "2026-2-03" }, 1, "program start date is malformed");
    rejects({ ...schedule, programStartDate: "2026-02-31" }, 1, "program start date is invalid");
  });
});
