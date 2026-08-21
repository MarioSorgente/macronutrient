/**
 * Deployment constants shared by every function.
 *
 * These are plain env values rather than secrets — knowing the region or the
 * restaurant id grants nothing. Real secrets go through Secret Manager
 * (`defineSecret`), never through here.
 */

/** Jakarta: the closest Cloud Functions region to Bali. */
export const REGION = "asia-southeast2";

export const RESTAURANT_ID = process.env.RESTAURANT_ID || "negrita";

/** Bali. Fixed UTC+8 year-round — WITA has no daylight saving. */
export const RESTAURANT_TIMEZONE =
  process.env.RESTAURANT_TIMEZONE || "Asia/Makassar";
