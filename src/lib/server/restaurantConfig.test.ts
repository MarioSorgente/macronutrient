import { describe, expect, it } from "vitest";
import { validateRestaurantConfig } from "@/lib/server/restaurantConfig";

const valid = {
  id: "negrita",
  name: "Negrita",
  timezone: "Asia/Makassar",
  cutoffDay: 6,
  cutoffTime: "18:00",
  serviceSlots: ["Breakfast", "Dinner"],
  serviceOpen: "07:00",
  serviceClose: "21:00",
  deliveryZones: [{ name: "Canggu", feeIdr: 25_000 }],
  markupPct: 12.5,
  acceptingOrders: true,
};

function rejected(patch: Record<string, unknown>, message: string): void {
  expect(() => validateRestaurantConfig({ ...valid, ...patch })).toThrow(message);
}

describe("validateRestaurantConfig", () => {
  it("rejects an unsupported IANA timezone", () => {
    rejected({ timezone: "Bali/Somewhere" }, "valid IANA time zone");
  });

  it.each([-1, 7, 1.5])("rejects cutoff day %s", (cutoffDay) => {
    rejected({ cutoffDay }, "whole number from 0 to 6");
  });

  it.each(["7:00", "24:00", "12:60"])("rejects malformed HH:mm value %s", (cutoffTime) => {
    rejected({ cutoffTime }, "valid 24-hour time");
  });

  it("rejects a service window that is empty or runs backwards", () => {
    rejected({ serviceOpen: "21:00", serviceClose: "07:00" }, "earlier than serviceClose");
    rejected({ serviceOpen: "07:00", serviceClose: "07:00" }, "earlier than serviceClose");
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])("rejects mark-up %s", (markupPct) => {
    rejected({ markupPct }, "percentage from 0 to 100");
  });

  it("rejects empty and duplicate delivery-zone names", () => {
    rejected({ deliveryZones: [{ name: "  ", feeIdr: 0 }] }, "non-empty string");
    rejected({ deliveryZones: [{ name: "Canggu", feeIdr: 0 }, { name: " canggu ", feeIdr: 1 }] }, "unique names");
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 100_000_001])("rejects delivery fee %s", (feeIdr) => {
    rejected({ deliveryZones: [{ name: "Canggu", feeIdr }] }, "finite amount");
  });

  it("rejects unbounded and invalid service-slot strings", () => {
    rejected({ serviceSlots: [] }, "between 1 and 24");
    rejected({ serviceSlots: Array.from({ length: 25 }, (_, i) => `Slot ${i}`) }, "between 1 and 24");
    rejected({ serviceSlots: ["x".repeat(51)] }, "at most 50 characters");
    rejected({ serviceSlots: ["Lunch", " lunch "] }, "must be unique");
  });

  it("returns a normalized, allow-listed shape for a valid round trip", () => {
    const normalized = validateRestaurantConfig({
      ...valid,
      name: "  Negrita Kitchen ",
      serviceSlots: [" Breakfast ", "Dinner"],
      deliveryZones: [{ name: " Canggu ", feeIdr: 25_000.5 }],
      unexpected: "not persisted",
    });

    expect(normalized).toEqual({
      ...valid,
      name: "Negrita Kitchen",
      serviceSlots: ["Breakfast", "Dinner"],
      deliveryZones: [{ name: "Canggu", feeIdr: 25_000.5 }],
    });
    expect(validateRestaurantConfig(normalized)).toEqual(normalized);
    expect(normalized).not.toHaveProperty("unexpected");
  });
});
