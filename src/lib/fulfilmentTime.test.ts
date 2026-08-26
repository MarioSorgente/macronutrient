import { describe, expect, it } from "vitest";
import { serviceTimeProblems } from "@/lib/fulfilmentTime";

const window = { serviceOpen: "07:00", serviceClose: "21:00" };
const problemsAt = (time: string) =>
  serviceTimeProblems([{ date: "2026-08-24", time }], window);

describe("serviceTimeProblems", () => {
  it("includes the exact opening and closing times", () => {
    expect(problemsAt("07:00")).toEqual([]);
    expect(problemsAt("21:00")).toEqual([]);
  });

  it("rejects one minute before opening with the date", () => {
    expect(problemsAt("06:59")).toEqual([
      "2026-08-24: choose a time between 07:00 and 21:00.",
    ]);
  });

  it("rejects one minute after closing with the date", () => {
    expect(problemsAt("21:01")).toEqual([
      "2026-08-24: choose a time between 07:00 and 21:00.",
    ]);
  });

  it("rejects malformed and ambiguous configuration", () => {
    expect(serviceTimeProblems([], { serviceOpen: "seven", serviceClose: "21:00" }))
      .toEqual(["Restaurant service hours are invalid. Please contact the restaurant."]);
    expect(serviceTimeProblems([], { serviceOpen: "07:00", serviceClose: "07:00" }))
      .toEqual(["Restaurant service hours are invalid. Please contact the restaurant."]);
  });

  it("supports an overnight window and keeps both endpoints inclusive", () => {
    const overnight = { serviceOpen: "18:00", serviceClose: "02:00" };
    expect(serviceTimeProblems([
      { date: "2026-08-24", time: "18:00" },
      { date: "2026-08-25", time: "00:30" },
      { date: "2026-08-25", time: "02:00" },
    ], overnight)).toEqual([]);
    expect(serviceTimeProblems([{ date: "2026-08-24", time: "12:00" }], overnight))
      .toHaveLength(1);
  });

  it("rejects a malformed requested time", () => {
    expect(problemsAt("7:00")).toEqual(["2026-08-24: pick a valid time."]);
  });
});
