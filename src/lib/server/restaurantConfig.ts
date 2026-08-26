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
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      bad(`deliveryZones[${index}] must be an object.`);
    }
    const candidate = entry as Record<string, unknown>;
    const fee = candidate.feeIdr;
    if (typeof fee !== "number" || !Number.isFinite(fee) || fee < 0 || fee > 100_000_000) {
      bad(`deliveryZones[${index}].feeIdr must be a finite amount from 0 to 100000000.`);
    }
    const name = text(candidate.name, `deliveryZones[${index}].name`);
    const key = name.toLocaleLowerCase("en-US");
    if (seen.has(key)) bad("deliveryZones must have unique names.");
    seen.add(key);
    return { name, feeIdr: fee };
  });
}

export type ValidRestaurantConfig = Omit<RestaurantConfig, "createdAt" | "updatedAt">;

/** Strictly validates untrusted settings and returns only their normalized public shape. */
export function validateRestaurantConfig(input: unknown): ValidRestaurantConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) bad("Restaurant settings must be an object.");
  const value = input as Record<string, unknown>;
  if (value.id !== undefined && value.id !== RESTAURANT_ID) bad("The restaurant id does not match this restaurant.");
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
  if (new Set(serviceSlots.map((slot) => slot.toLocaleLowerCase("en-US"))).size !== serviceSlots.length) {
    bad("serviceSlots must be unique.");
  }
  const serviceOpen = time(value.serviceOpen, "serviceOpen");
  const serviceClose = time(value.serviceClose, "serviceClose");
  if (serviceOpen >= serviceClose) bad("serviceOpen must be earlier than serviceClose.");

  return {
    id: RESTAURANT_ID,
    name: text(value.name, "name"),
    timezone: timezone(value.timezone),
    cutoffDay: value.cutoffDay as number,
    cutoffTime: time(value.cutoffTime, "cutoffTime"),
    serviceSlots,
    serviceOpen,
    serviceClose,
    deliveryZones: zones(value.deliveryZones),
    markupPct: value.markupPct,
    acceptingOrders: value.acceptingOrders,
  };
}

/** Validates and persists the public restaurant settings at the server boundary. */
export async function updateRestaurantConfig(
  caller: RestaurantCaller,
  input: unknown
): Promise<{ updated: true }> {
  if (caller.role !== "admin") {
    throw new HttpError(403, "You cannot configure this restaurant.");
  }
  const config = validateRestaurantConfig(input);
  const ref = adminDb().doc(`restaurants/${RESTAURANT_ID}`);
  await adminDb().runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    transaction.set(ref, {
      ...config,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: existing.exists && existing.get("createdAt")
        ? existing.get("createdAt")
        : FieldValue.serverTimestamp(),
    });
  });
  return { updated: true };
}
