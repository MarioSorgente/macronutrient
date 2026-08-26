import { beforeEach, describe, expect, it } from "vitest";
import { HttpError } from "@/lib/server/auth";
import { updateRestaurantConfig } from "@/lib/server/restaurantConfig";
import { DEFAULT_RESTAURANT_CONFIG } from "@/lib/storage/types";
import { RID, docAt, resetEmulators } from "./serverHarness";

const valid = { ...DEFAULT_RESTAURANT_CONFIG, id: RID };

beforeEach(resetEmulators);

describe("restaurant configuration route logic", () => {
  it("rejects staff and an admin claimed by another restaurant", async () => {
    await expect(updateRestaurantConfig({ uid: "staff", role: "restaurant", rid: RID }, valid))
      .rejects.toMatchObject({ status: 403 });
    await expect(updateRestaurantConfig({ uid: "admin", role: "admin", rid: "other" }, valid))
      .rejects.toMatchObject({ status: 403 });
  });

  it("lets the correctly scoped admin save validated settings", async () => {
    await expect(updateRestaurantConfig({ uid: "admin", role: "admin", rid: RID }, {
      ...valid, markupPct: 12.5, deliveryZones: [{ name: "Canggu", feeIdr: 25_000 }],
    })).resolves.toEqual({ updated: true });
    expect(await docAt(`restaurants/${RID}`)).toMatchObject({
      id: RID, markupPct: 12.5, deliveryZones: [{ name: "Canggu", feeIdr: 25_000 }],
    });
  });

  it.each([
    ["timezone", { timezone: "Mars/Olympus" }],
    ["time", { cutoffTime: "25:00" }],
    ["percentage", { markupPct: Number.NaN }],
    ["delivery zone", { deliveryZones: [{ name: "Canggu", feeIdr: -1 }] }],
  ])("rejects malformed %s values without writing", async (_label, over) => {
    await expect(updateRestaurantConfig({ uid: "admin", role: "admin", rid: RID }, { ...valid, ...over }))
      .rejects.toBeInstanceOf(HttpError);
    expect(await docAt(`restaurants/${RID}`)).toBeNull();
  });
});
