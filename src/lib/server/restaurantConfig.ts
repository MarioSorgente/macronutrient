import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { RESTAURANT_ID } from "@/lib/firebaseEnv";
import { HttpError, type RestaurantCaller } from "@/lib/server/auth";
import { adminDb } from "@/lib/server/firebaseAdmin";
import type { DeliveryZone, RestaurantConfig } from "@/lib/storage/types";

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function bad(message: string): never {
  throw new HttpError(400, message);
}

function text(value: unknown, field: string, max = 100): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    bad(`${field} must be a non-empty string of at most ${max} characters.`);
  }
  return value.trim();
}

function time(value: unknown, field: string): string {
  if (typeof value !== "string" || !TIME.test(value)) {
    bad(`${field} must be a valid 24-hour time (HH:mm).`);
  }
  return value;
}

function timezone(value: unknown): string {
  const zone = text(value, "timezone");
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format();
  } catch {
    bad("timezone must be a valid IANA time zone.");
  }
  return zone;
}

function zones(value: unknown): DeliveryZone[] {
  if (!Array.isArray(value) || value.length > 100) {
    bad("deliveryZones must be an array of at most 100 zones.");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      bad(`deliveryZones[${index}] must be an object.`);
    }
    const candidate = entry as Record<string, unknown>;
    const fee = candidate.feeIdr;
    if (!Number.isSafeInteger(fee) || (fee as number) < 0 || (fee as number) > 100_000_000) {
      bad(`deliveryZones[${index}].feeIdr must be a whole amount from 0 to 100000000.`);
    }
    return { name: text(candidate.name, `deliveryZones[${index}].name`), feeIdr: fee as number };
  });
}

/** Validates and persists the public restaurant settings at the server boundary. */
export async function updateRestaurantConfig(
  caller: RestaurantCaller,
  input: unknown
): Promise<{ updated: true }> {
  if (caller.role !== "admin" || caller.rid !== RESTAURANT_ID) {
    throw new HttpError(403, "You cannot configure this restaurant.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    bad("Restaurant settings must be an object.");
  }
  const value = input as Record<string, unknown>;
  if (value.id !== undefined && value.id !== RESTAURANT_ID) {
    bad("The restaurant id does not match this restaurant.");
  }
  if (!Number.isInteger(value.cutoffDay) || (value.cutoffDay as number) < 0 || (value.cutoffDay as number) > 6) {
    bad("cutoffDay must be a whole number from 0 to 6.");
  }
  if (typeof value.markupPct !== "number" || !Number.isFinite(value.markupPct) || value.markupPct < 0 || value.markupPct > 100) {
    bad("markupPct must be a percentage from 0 to 100.");
  }
  if (typeof value.acceptingOrders !== "boolean") bad("acceptingOrders must be a boolean.");
  if (!Array.isArray(value.serviceSlots) || value.serviceSlots.length < 1 || value.serviceSlots.length > 24) {
    bad("serviceSlots must contain between 1 and 24 entries.");
  }
  const serviceSlots = value.serviceSlots.map((slot, index) => text(slot, `serviceSlots[${index}]`, 50));
  if (new Set(serviceSlots).size !== serviceSlots.length) bad("serviceSlots must be unique.");

  const config: Omit<RestaurantConfig, "createdAt" | "updatedAt"> = {
    id: RESTAURANT_ID,
    name: text(value.name, "name"),
    timezone: timezone(value.timezone),
    cutoffDay: value.cutoffDay as number,
    cutoffTime: time(value.cutoffTime, "cutoffTime"),
    serviceSlots,
    serviceOpen: time(value.serviceOpen, "serviceOpen"),
    serviceClose: time(value.serviceClose, "serviceClose"),
    deliveryZones: zones(value.deliveryZones),
    markupPct: value.markupPct,
    acceptingOrders: value.acceptingOrders,
  };
  const ref = adminDb().doc(`restaurants/${RESTAURANT_ID}`);
  await adminDb().runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    transaction.set(ref, {
      ...config,
      updatedAt: FieldValue.serverTimestamp(),
      ...(!existing.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
    }, { merge: true });
  });
  return { updated: true };
}
