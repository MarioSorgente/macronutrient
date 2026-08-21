import { describe, expect, it } from "vitest";
import { cutoffFor, cutoffState, formatRemaining, zonedToInstant } from "@/lib/cutoff";

const BALI = { timezone: "Asia/Makassar", cutoffDay: 6, cutoffTime: "18:00" };

describe("zonedToInstant", () => {
  it("reads a wall time as Bali time, not as UTC", () => {
    // Bali is UTC+8, so 18:00 there is 10:00 UTC the same day.
    expect(zonedToInstant("2026-08-23", "18:00", "Asia/Makassar").toISOString())
      .toBe("2026-08-23T10:00:00.000Z");
  });

  it("crosses the date boundary correctly near midnight", () => {
    // 00:30 in Bali is still the previous day in UTC — the case that makes a
    // naive implementation put a prep task on the wrong day.
    expect(zonedToInstant("2026-08-24", "00:30", "Asia/Makassar").toISOString())
      .toBe("2026-08-23T16:30:00.000Z");
  });

  it("handles a zone that does observe daylight saving", () => {
    // London in August is UTC+1.
    expect(zonedToInstant("2026-08-23", "18:00", "Europe/London").toISOString())
      .toBe("2026-08-23T17:00:00.000Z");
    // ...and UTC+0 in January, from the same code path.
    expect(zonedToInstant("2026-01-23", "18:00", "Europe/London").toISOString())
      .toBe("2026-01-23T18:00:00.000Z");
  });
});

describe("cutoffFor", () => {
  it("falls on the Sunday evening before the week opens", () => {
    // Week of Monday 24 Aug 2026 closes Sunday 23 Aug, 18:00 Bali.
    expect(cutoffFor("2026-08-24", BALI).toISOString())
      .toBe("2026-08-23T10:00:00.000Z");
  });

  it("moves with the configured day", () => {
    // Friday (day 4) of the preceding week instead.
    const friday = { ...BALI, cutoffDay: 4 };
    expect(cutoffFor("2026-08-24", friday).toISOString())
      .toBe("2026-08-21T10:00:00.000Z");
  });
});

describe("cutoffState", () => {
  it("is open a minute before and closed a minute after", () => {
    const at = cutoffFor("2026-08-24", BALI);

    const before = new Date(at.getTime() - 60_000);
    expect(cutoffState("2026-08-24", BALI, before).passed).toBe(false);

    const after = new Date(at.getTime() + 60_000);
    expect(cutoffState("2026-08-24", BALI, after).passed).toBe(true);
  });

  it("treats the exact cutoff instant as closed", () => {
    const at = cutoffFor("2026-08-24", BALI);
    expect(cutoffState("2026-08-24", BALI, at).passed).toBe(true);
  });

  it("is not fooled by a machine running on UTC", () => {
    // 11:00 UTC on 23 Aug is 19:00 in Bali — an hour past the deadline. A
    // server comparing local wall-clock times would call this open.
    const utcEvening = new Date("2026-08-23T11:00:00.000Z");
    expect(cutoffState("2026-08-24", BALI, utcEvening).passed).toBe(true);
  });
});

describe("formatRemaining", () => {
  it("describes the time left in the largest useful unit", () => {
    expect(formatRemaining(-1)).toBe("closed");
    expect(formatRemaining(45 * 60_000)).toBe("45m");
    expect(formatRemaining(3 * 3_600_000 + 20 * 60_000)).toBe("3h 20m");
    expect(formatRemaining(2 * 86_400_000 + 4 * 3_600_000)).toBe("2d 4h");
  });
});
