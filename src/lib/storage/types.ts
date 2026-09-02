import type { Macros } from "@/types/nutrition";

/** Everything we persist is keyed by id and carries timestamps for sorting. */
export interface Entity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

// --- Dishes -----------------------------------------------------------------

export interface DishItem {
  ingredientId: string;
  /** Name captured at save time so reports render even if data changes later. */
  name: string;
  /** Authoritative amount for all macro math. */
  grams: number;
  /** Portion unit the user is working in ("g" for plain grams). */
  unitId: string;
  /** Amount expressed in `unitId`; grams = quantity * unit.gramWeight. */
  quantity: number;
}

export interface Dish extends Entity {
  name: string;
  items: DishItem[];
  /** Cached totals at save time (also recomputed live when rendering). */
  totals: Macros;
}

// --- Clients ----------------------------------------------------------------

export interface MacroTargets {
  energy_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface Assignment {
  id: string;
  /** 1-based week within the program (1..weekCount). */
  week: number;
  /** 0 = Monday .. 6 = Sunday. */
  day: number;
  /** Meal slot name, matching one of the client's `mealSlots`. */
  slot: string;
  /** Set when the meal came from a saved dish. Absent for generated meals. */
  dishId?: string;
  /**
   * Set when this meal *is* a Negrita menu dish, identified by its recipe id.
   *
   * The identity is what makes the dish authoritative rather than the copy of
   * it stored here: price resolves to the menu's own `price_idr` and macros to
   * its published `menu_macros_per_serving`, both looked up fresh. Without it
   * the plan re-derives both from the ingredient list — pricing a Rp 89,000
   * pancake at Rp 15,000 and counting it as 1,139 kcal instead of the 1,095 the
   * menu sells and the planner aimed at.
   *
   * Absent for DIY and saved dishes, which are correctly priced and counted
   * from their components.
   */
  menuRecipeId?: string;
  /**
   * Ingredients of a meal built by the auto-planner. Held inline so generated
   * plans do not flood the saved-dish library; a meal worth keeping can still
   * be saved as a dish explicitly.
   */
  items?: DishItem[];
  servings: number;
  /**
   * Known cost of one serving. Set when the meal has an authoritative price —
   * a menu dish is sold for its menu price, not the sum of its parts — so the
   * plan does not re-derive a different (and partial) figure from components.
   */
  price?: { totalIdr: number; complete: boolean };
  /**
   * Copy of the meal at assignment time. Keeps a plan readable even if the
   * dish is later deleted; the live dish wins whenever it still exists.
   */
  snapshot: { name: string; totals: Macros };
}

export type MacroStyle =
  | "high_protein"
  | "balanced"
  | "low_carb"
  | "high_carb";

/** How the resolved targets were chosen. A preset exists only in preset mode. */
export type TargetMode = "preset" | "custom";

export type ProteinSource =
  | "chicken"
  | "beef"
  | "fish"
  | "eggs"
  | "pork"
  | "veg";

/**
 * What a client likes. `proteinLean` biases the mix toward those sources
 * without ever excluding the others; `avoidIngredientIds` is the hard rule,
 * because a dislike or allergy is not a preference.
 */
export interface ClientPreferences {
  /** @deprecated Target selection now lives on Plan.targetMode/targetPreset. */
  macroStyle?: MacroStyle;
  proteinLean: ProteinSource[];
  avoidIngredientIds: string[];
}

export const DEFAULT_PREFERENCES: ClientPreferences = {
  macroStyle: "balanced",
  proteinLean: [],
  avoidIngredientIds: [],
};

export type PlanStatus = "draft" | "submitted" | "locked";

/**
 * One person's eating plan.
 *
 * This was `Client` — a record a coach kept about someone else. A person now
 * plans their own week, so the entity belongs to them: it is stored under
 * `users/{uid}/plans` and `ownerUid` records whose it is even after export.
 */
export interface Plan extends Entity {
  /** Firebase uid of the owner. Empty string for a guest plan on this device. */
  ownerUid: string;
  /** What the person calls this plan, e.g. "My week". */
  title: string;
  notes?: string;
  /** Optional daily goals; adherence UI only appears when this is set. */
  targets: MacroTargets | null;
  /** Authoritative target-selection mode; never inferred from target completeness. */
  targetMode: TargetMode;
  /** Present only while targetMode is "preset". */
  targetPreset?: MacroStyle;
  /** Tastes, remembered between generations. */
  preferences?: ClientPreferences;
  /** Editable meal slot names, e.g. ["Breakfast", "Lunch", "Dinner"]. */
  mealSlots: string[];
  /** ISO date (yyyy-mm-dd) of week 1, day 1. */
  programStartDate: string;
  /** Program length in weeks, 1..6. */
  weekCount: number;
  /** Every planned meal, flat. Filtered by week/day/slot when rendering. */
  assignments: Assignment[];
  status: PlanStatus;
  /** Weeks already sent to the kitchen, so they can be shown as locked. */
  submittedWeeks: number[];
}

export const MAX_PROGRAM_WEEKS = 6;

export const DEFAULT_MEAL_SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];

// --- Accounts ---------------------------------------------------------------

/**
 * Who someone is to the restaurant.
 *
 * The authoritative copy lives in the Firebase Auth token as a custom claim —
 * security rules read `request.auth.token.role` and nothing else. The copy on
 * the user document below is for rendering only, and a user is never allowed
 * to write it.
 */
export type Role = "client" | "restaurant" | "admin";

export type StaffRequestStatus = "pending" | "approving" | "approved" | "rejected";

export interface StaffAccessRequest {
  id: string;
  restaurantId: string;
  uid: string;
  email: string;
  displayName?: string;
  emailVerified: boolean;
  status: StaffRequestStatus;
  createdAt: string;
  reviewedAt?: string;
  reviewedByUid?: string;
  /** Stable identity of an in-progress/completed approval attempt. */
  reviewOperationId?: string;
  /** Role the approval operation must apply when it is resumed. */
  intendedRole?: Role;
  /** Result of reconciling a pending request with its Firebase Auth account. */
  accountState?: "available" | "unavailable";
  /** Why an unavailable request cannot be approved, while it remains rejectable. */
  accountUnavailableReason?: "user-not-found" | "malformed-request";
}

export interface UserProfile extends Entity {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  phone?: string;
  defaultAddress?: string;
  /** DISPLAY MIRROR of the custom claim — never trusted for access decisions. */
  role: Role;
  /** Restaurant this account belongs to. */
  rid: string;
  /** Bumped when a role changes, so the client knows to refresh its token. */
  roleUpdatedAt?: string;
  // --- usage metrics, stamped by the client on sign-in ---
  lastLoginAt?: string;
  loginCount?: number;
  signupMethod?: "google" | "password";
}

// --- Orders -----------------------------------------------------------------

export type FulfilmentMode = "pickup" | "delivery";

/** How one day's food reaches the person. Chosen per day, not per week. */
export interface Fulfilment {
  mode: FulfilmentMode;
  /** "12:30" — Bali wall-clock time. */
  time: string;
  /** Required when mode is "delivery". */
  address?: string;
  note?: string;
}

export interface OrderMeal {
  assignmentId: string;
  slot: string;
  name: string;
  servings: number;
  /** Resolved ingredients, so the kitchen sees exact grams without a lookup. */
  items: DishItem[];
  /** Recomputed on the server; never taken from the client. */
  totals: Macros;
  priceIdr: number;
  /**
   * Whether `priceIdr` covers the whole meal.
   *
   * Preview-only, and never written to Firestore: the server refuses an order
   * containing an unpriced meal, so a stored one is always fully priced. The
   * submit screen needs the distinction before it quotes a total, because
   * rendering a confident figure and then being 400ed is the worst of both.
   */
  priced?: boolean;
}

export interface OrderDay {
  /** ISO yyyy-mm-dd, Bali calendar date. */
  date: string;
  fulfilment: Fulfilment;
  meals: OrderMeal[];
}

export type OrderStatus =
  | "submitted"
  | "accepted"
  | "in_prep"
  | "ready"
  | "completed"
  | "rejected"
  | "cancelled";

/** Statuses that still represent a live commitment from the kitchen. */
export const LIVE_ORDER_STATUSES: OrderStatus[] = [
  "submitted",
  "accepted",
  "in_prep",
  "ready",
  "completed",
];

/**
 * Reserved now so adding a payment provider later is a feature rather than a
 * migration. Nothing writes anything but the default today.
 */
export interface OrderPayment {
  status: "unpaid" | "paid" | "refunded";
  method: "cash" | "transfer" | "online";
  amountIdr: number;
  paidAt?: string;
  provider?: string;
  reference?: string;
}

export interface OrderStatusChange {
  status: OrderStatus;
  at: string;
  byUid: string;
}

/**
 * A week of meals committed to the kitchen.
 *
 * Carries its own copy of everything ordered rather than pointing at the plan,
 * which is what lets the restaurant work from it without ever reading someone's
 * private plan — and what keeps the record honest if the plan changes later.
 */
export interface Order extends Entity {
  restaurantId: string;
  userId: string;
  planId: string;
  weekNumber: number;
  /** ISO yyyy-mm-dd of the Monday this order covers. */
  weekStartDate: string;
  status: OrderStatus;
  /** Snapshot, so the kitchen is not reading the customer's profile. */
  customer: { name: string; email: string; phone?: string };
  days: OrderDay[];
  totals: Macros;
  /** Server-computed. The revenue figure the dashboard sums. */
  priceIdr: number;
  mealCount: number;
  payment: OrderPayment;
  submittedAt: string;
  /** The cutoff instant that applied when this was accepted. */
  lockedAt: string;
  statusHistory: OrderStatusChange[];
  restaurantNote?: string;
}

export type PrepStatus = "todo" | "prepping" | "ready" | "done";

/** One meal, one day, one customer — the atom of the kitchen's todo list. */
export interface PrepTask extends Entity {
  restaurantId: string;
  orderId: string;
  userId: string;
  /** ISO yyyy-mm-dd, Bali. The key the kitchen board queries on. */
  date: string;
  slot: string;
  /** "12:30" Bali — what the board sorts and groups by. */
  readyBy: string;
  mode: FulfilmentMode;
  customerName: string;
  address?: string;
  mealName: string;
  servings: number;
  items: DishItem[];
  totals: Macros;
  status: PrepStatus;
  doneAt?: string;
  doneByUid?: string;
}

// --- Restaurant -------------------------------------------------------------

export interface DeliveryZone {
  name: string;
  feeIdr: number;
}

/** Everything about how Negrita takes orders, editable by the admin. */
export interface RestaurantConfig extends Entity {
  name: string;
  /** IANA zone. Bali: "Asia/Makassar". */
  timezone: string;
  /** 0 = Monday .. 6 = Sunday. */
  cutoffDay: number;
  /** "18:00" in the restaurant's own timezone. */
  cutoffTime: string;
  serviceSlots: string[];
  /** Earliest and latest a meal can be asked for, Bali wall-clock. */
  serviceOpen: string;
  serviceClose: string;
  deliveryZones: DeliveryZone[];
  /** Percentage added to the DIY component cost to reach the menu price. */
  markupPct: number;
  acceptingOrders: boolean;
}

export const DEFAULT_RESTAURANT_CONFIG: Omit<RestaurantConfig, keyof Entity> = {
  name: "Negrita",
  timezone: "Asia/Makassar",
  cutoffDay: 6, // Sunday
  cutoffTime: "18:00",
  serviceSlots: [...DEFAULT_MEAL_SLOTS],
  serviceOpen: "07:00",
  serviceClose: "21:00",
  deliveryZones: [],
  markupPct: 0,
  acceptingOrders: true,
};

// --- House recipes ----------------------------------------------------------

export interface HouseRecipeComponent {
  ingredientId: string;
  grams: number;
}

/**
 * A Negrita house item defined from its own components. Lets the restaurant
 * replace an estimated proxy with exact values: per-100 g macros are derived as
 * sum(components) / yieldGrams * 100.
 */
export interface HouseRecipe extends Entity {
  /** id === the ingredient_id this recipe overrides. */
  ingredientId: string;
  components: HouseRecipeComponent[];
  /** Finished batch weight after cooking/mixing. */
  yieldGrams: number;
}

// --- Repository -------------------------------------------------------------

/**
 * Persistence contract. The localStorage implementation (used now) and the
 * Firestore implementation (prepared for later) both satisfy it, so swapping
 * backends requires no changes to UI or logic.
 */
export interface Repository<T extends Entity> {
  list(): Promise<T[]>;
  /** Returns the most recently updated entity without loading the full list. */
  latest(): Promise<T | null>;
  get(id: string): Promise<T | null>;
  save(entity: T): Promise<T>;
  remove(id: string): Promise<void>;
}

export type DishRepository = Repository<Dish>;
export type OrderRepository = Repository<Order>;
export type PrepTaskRepository = Repository<PrepTask>;
export type PlanRepository = Repository<Plan>;
export type HouseRecipeRepository = Repository<HouseRecipe>;
