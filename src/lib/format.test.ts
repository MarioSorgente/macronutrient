import { describe, expect, it } from "vitest";
import {
  BALI_TZ,
  addDays,
  baliDateOf,
  baliToday,
  baliWeekStart,
  dayIndex,
  formatBali,
  formatBaliDateTime,
  formatBaliDay,
  formatDate,
  formatMacroGrams,
  grams,
  wholeNonNegative,
  round0,
  round1,
} from "@/lib/format";

/**
 * Display helpers. The Bali ones are load-bearing rather than cosmetic: a prep
 * day, an order cutoff and a pickup slot are all Bali wall-clock concepts, and
 * a staff member on a UTC laptop must not be shown the wrong day's prep list.
 */

describe("round0", () => {
  it("rounds to a whole number with thousands separators", () => {
    expect(round0(1234.6)).toBe("1,235");
    expect(round0(0.4)).toBe("0");
  });
});

describe("macro presentation and input boundaries", () => {
  it("formats macro grams as whole numbers without negative zero", () => {
    expect(formatMacroGrams(66.7)).toBe("67");
    expect(formatMacroGrams(37.49)).toBe("37");
    expect(formatMacroGrams(-0.4)).toBe("0");
    expect(round0(-0.4)).toBe("0");
  });

  it("normalizes saved calorie and macro values to finite non-negative integers", () => {
    expect(wholeNonNegative(66.7)).toBe(67);
    expect(wholeNonNegative(-12)).toBe(0);
    expect(wholeNonNegative(Number.POSITIVE_INFINITY)).toBe(0);
    expect(wholeNonNegative(Number.NaN)).toBe(0);
  });
});

describe("round1 and grams", () => {
  it("trims a trailing .0 but keeps a real decimal", () => {
    expect(round1(12)).toBe("12");
    expect(round1(12.04)).toBe("12");
    expect(round1(12.35)).toBe("12.4");
    expect(grams(150)).toBe("150");
    expect(grams(150.25)).toBe("150.3");
  });

  it("grams has no thousands separator, since it feeds an editable field", () => {
    expect(grams(1500)).toBe("1500");
  });
});

describe("formatBali with a date-only string", () => {
  it("does not shift a calendar date backwards in a western zone", () => {
    // "2026-08-24" is a calendar date with no instant. Parsing it as UTC
    // midnight and rendering it locally would show the 23rd west of Greenwich.
    expect(formatBali("2026-08-24")).toBe("Aug 24, 2026");
    expect(formatBaliDay("2026-08-24")).toBe("Mon, Aug 24");
  });

  it("formatDate delegates to the same safe path", () => {
    expect(formatDate("2026-08-24")).toBe("Aug 24, 2026");
  });
});

describe("formatBali with a full instant", () => {
  it("renders in Bali time, not UTC", () => {
    // 2026-08-24T16:00Z is 00:00 on the 25th in Bali (UTC+8).
    expect(formatBaliDateTime("2026-08-24T16:00:00.000Z"))
      .toBe("Aug 25, 2026, 00:00");
  });

  it("uses a 24-hour clock", () => {
    expect(formatBaliDateTime("2026-08-24T10:00:00.000Z"))
      .toBe("Aug 24, 2026, 18:00");
  });

  it("returns the input unchanged rather than throwing on nonsense", () => {
    expect(formatBali("not-a-date")).toBe("not-a-date");
  });
});

describe("baliDateOf", () => {
  it("gives the Bali calendar date an instant falls on", () => {
    expect(baliDateOf(new Date("2026-08-24T15:59:00.000Z"))).toBe("2026-08-24");
    // One minute later it is already tomorrow in Bali.
    expect(baliDateOf(new Date("2026-08-24T16:00:00.000Z"))).toBe("2026-08-25");
  });

  it("baliToday returns a yyyy-mm-dd shape", () => {
    expect(baliToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses the Bali zone constant", () => {
    expect(BALI_TZ).toBe("Asia/Makassar");
  });
});

describe("addDays", () => {
  it("adds and subtracts whole calendar days", () => {
    expect(addDays("2026-08-24", 7)).toBe("2026-08-31");
    expect(addDays("2026-08-24", -1)).toBe("2026-08-23");
    expect(addDays("2026-08-24", 0)).toBe("2026-08-24");
  });

  it("crosses month and year boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });
});

describe("dayIndex", () => {
  it("is 0 for Monday through 6 for Sunday, matching Assignment.day", () => {
    expect(dayIndex("2026-08-24")).toBe(0); // Monday
    expect(dayIndex("2026-08-25")).toBe(1);
    expect(dayIndex("2026-08-29")).toBe(5); // Saturday
    expect(dayIndex("2026-08-30")).toBe(6); // Sunday
  });
});

describe("baliWeekStart", () => {
  it("returns the Monday of the containing week", () => {
    expect(baliWeekStart("2026-08-24")).toBe("2026-08-24"); // already Monday
    expect(baliWeekStart("2026-08-27")).toBe("2026-08-24");
    expect(baliWeekStart("2026-08-30")).toBe("2026-08-24"); // Sunday belongs back
  });

  it("defaults to this week in Bali", () => {
    expect(baliWeekStart()).toBe(baliWeekStart(baliToday()));
    expect(dayIndex(baliWeekStart())).toBe(0);
  });
});
