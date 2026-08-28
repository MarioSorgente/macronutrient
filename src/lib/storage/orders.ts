import { RESTAURANT_ID } from "@/lib/firebaseEnv";
import { isCloudBackend } from "@/lib/storage";
import type {
  Fulfilment,
  Order,
  OrderStatus,
  PrepStatus,
  PrepTask,
  RestaurantConfig,
  UserProfile,
} from "@/lib/storage/types";
import { DEFAULT_RESTAURANT_CONFIG } from "@/lib/storage/types";

/**
 * Reads and writes for orders, prep tasks and restaurant settings.
 *
 * These are queries rather than plain collections — "my orders", "today's
 * tasks", "orders awaiting acceptance" — so they sit here instead of being
 * forced through the id-keyed Repository contract, which has no notion of a
 * filter. The Firestore SDK is still imported lazily, for the same reason it is
 * everywhere else: guests never load it.
 */

const ORDERS = `restaurants/${RESTAURANT_ID}/orders`;
const PREP_TASKS = `restaurants/${RESTAURANT_ID}/prepTasks`;

async function firestore() {
  const [{ getDb }, sdk] = await Promise.all([
    import("@/lib/storage/firebaseClient"),
    import("firebase/firestore"),
  ]);
  return { db: getDb(), ...sdk };
}

function requireCloud(action: string): void {
  if (!isCloudBackend()) {
    throw new Error(
      `${action} needs the cloud backend — set NEXT_PUBLIC_STORAGE_BACKEND=firebase.`
    );
  }
}

// --- Orders -----------------------------------------------------------------

/**
 * One person's orders, newest first.
 *
 * The `userId` filter is not just an optimisation: the security rules only
 * permit a list that is provably restricted to a single person, so a customer
 * reading their own orders needs it, and staff reading one customer's orders
 * get to use the same index instead of scanning the whole order book.
 */
export async function listOrdersByUser(uid: string): Promise<Order[]> {
  requireCloud("Reading orders");
  const { db, collection, getDocs, orderBy, query, where } = await firestore();
  const snap = await getDocs(
    query(
      collection(db, ORDERS),
      where("userId", "==", uid),
      orderBy("submittedAt", "desc")
    )
  );
  return snap.docs.map((d) => d.data() as Order);
}

/** A person's own orders. Kept as the name the customer-facing screens use. */
export const listMyOrders = listOrdersByUser;

export async function getOrder(orderId: string): Promise<Order | null> {
  requireCloud("Reading an order");
  const { db, doc, getDoc } = await firestore();
  const snap = await getDoc(doc(db, ORDERS, orderId));
  return snap.exists() ? (snap.data() as Order) : null;
}

/**
 * Every order, for the kitchen and the dashboard. Newest service week first.
 *
 * Bounded on purpose: the dashboard charts a rolling window and the kitchen
 * works from recent weeks, so an unbounded read would grow forever to show
 * numbers nothing on screen actually uses.
 */
/**
 * How many orders the owner dashboard reads.
 *
 * Higher than the kitchen default because the dashboard offers an "all time"
 * period, and named so the screen can say out loud when it has hit the ceiling
 * rather than quietly reporting a partial total as a lifetime one.
 */
export const DASHBOARD_ORDER_LIMIT = 500;

export async function listAllOrders(max = 200): Promise<Order[]> {
  requireCloud("Reading the order book");
  const { db, collection, getDocs, limit, orderBy, query } = await firestore();
  const snap = await getDocs(
    query(collection(db, ORDERS), orderBy("weekStartDate", "desc"), limit(max))
  );
  return snap.docs.map((d) => d.data() as Order);
}

/**
 * Live updates for the order book, so two people working the pass stay in step.
 *
 * The prep board has had this since it was written; the order list did not, and
 * only re-read after its own status change. One person accepting an order left
 * the other looking at it as still waiting until they reloaded the page.
 */
export async function watchAllOrders(
  onChange: (orders: Order[]) => void,
  onError: (cause: unknown) => void,
  max = 200
): Promise<() => void> {
  requireCloud("Watching the order book");
  const { db, collection, limit, onSnapshot, orderBy, query } = await firestore();
  return onSnapshot(
    query(collection(db, ORDERS), orderBy("weekStartDate", "desc"), limit(max)),
    (snap) => onChange(snap.docs.map((d) => d.data() as Order)),
    onError
  );
}

/**
 * Moves an order through its lifecycle.
 *
 * Server-side, because a cancelled or rejected order also has to clear the
 * kitchen's board and free the week on the plan — work a browser is not
 * allowed to do, and which used to be a Firestore trigger. Doing it in the
 * same request removes the window where an order is dead but the kitchen is
 * still cooking it.
 */
export async function setOrderStatus(
  order: Order,
  status: OrderStatus,
  _byUid: string,
  note?: string
): Promise<void> {
  requireCloud("Updating an order");
  const { callApi } = await import("@/lib/api");
  await callApi("/api/orders/status", { orderId: order.id, status, note });
}

/**
 * Cancels a week the kitchen has not started yet.
 *
 * Only the status moves; a Cloud Function clears the prep tasks and frees the
 * week on the plan, because a customer is not allowed to write the kitchen's
 * board — and should not have to remember to.
 */
export async function cancelOrder(order: Order, byUid: string): Promise<void> {
  await setOrderStatus(order, "cancelled", byUid);
}

// --- Prep tasks -------------------------------------------------------------

/** One day's kitchen work, in the order it has to be ready. */
export async function listPrepTasks(date: string): Promise<PrepTask[]> {
  requireCloud("Reading the kitchen board");
  const { db, collection, getDocs, orderBy, query, where } = await firestore();
  const snap = await getDocs(
    query(
      collection(db, PREP_TASKS),
      where("date", "==", date),
      orderBy("readyBy", "asc")
    )
  );
  return snap.docs.map((d) => d.data() as PrepTask);
}

/** All task state needed to decide aggregate order actions in the order book. */
export async function listAllPrepTasks(): Promise<PrepTask[]> {
  requireCloud("Reading prep progress");
  const { db, collection, getDocs } = await firestore();
  const snap = await getDocs(collection(db, PREP_TASKS));
  return snap.docs.map((d) => d.data() as PrepTask);
}

export async function listOrderPrepTasks(orderId: string): Promise<PrepTask[]> {
  requireCloud("Reading order prep progress");
  const { db, collection, getDocs, query, where } = await firestore();
  const snap = await getDocs(query(collection(db, PREP_TASKS), where("orderId", "==", orderId)));
  return snap.docs.map((d) => d.data() as PrepTask);
}

/** Live updates for the board, so two people in the kitchen stay in step. */
export async function watchPrepTasks(
  date: string,
  onChange: (tasks: PrepTask[]) => void,
  onError: (cause: unknown) => void
): Promise<() => void> {
  requireCloud("Watching the kitchen board");
  const { db, collection, onSnapshot, orderBy, query, where } = await firestore();
  return onSnapshot(
    query(
      collection(db, PREP_TASKS),
      where("date", "==", date),
      orderBy("readyBy", "asc")
    ),
    (snap) => onChange(snap.docs.map((d) => d.data() as PrepTask)),
    onError
  );
}

export async function setPrepStatus(
  taskId: string,
  status: PrepStatus,
  _byUid: string
): Promise<void> {
  requireCloud("Updating a prep task");
  const { callApi } = await import("@/lib/api");
  await callApi("/api/prep-tasks/status", { taskId, status });
}

// --- Restaurant config ------------------------------------------------------

/**
 * Restaurant settings, falling back to the defaults when nothing is saved yet.
 *
 * Readable without an account: the cutoff has to be shown to a guest deciding
 * whether it is still worth planning this week.
 */
let configCache: Promise<RestaurantConfig> | null = null;

/** Drops the cached settings so a save is reflected immediately. */
export function invalidateRestaurantConfig(): void {
  configCache = null;
}

export function loadRestaurantConfig(): Promise<RestaurantConfig> {
  // Settings change perhaps monthly but are read by the planner, the submit
  // screen and the kitchen board. One read per session is plenty.
  return (configCache ??= fetchRestaurantConfig());
}

async function fetchRestaurantConfig(): Promise<RestaurantConfig> {
  const now = new Date().toISOString();
  const fallback: RestaurantConfig = {
    id: RESTAURANT_ID,
    createdAt: now,
    updatedAt: now,
    ...DEFAULT_RESTAURANT_CONFIG,
  };
  if (!isCloudBackend()) return fallback;

  try {
    const { db, doc, getDoc } = await firestore();
    const snap = await getDoc(doc(db, "restaurants", RESTAURANT_ID));
    return snap.exists()
      ? { ...fallback, ...(snap.data() as Partial<RestaurantConfig>) }
      : fallback;
  } catch {
    // Settings are not worth blocking the planner over.
    return fallback;
  }
}

export async function saveRestaurantConfig(
  config: RestaurantConfig
): Promise<void> {
  requireCloud("Saving restaurant settings");
  const { callApi } = await import("@/lib/api");
  await callApi("/api/admin/restaurant-config", config);
  invalidateRestaurantConfig();
}

// --- People (admin) ---------------------------------------------------------

/**
 * The customer list.
 *
 * Bounded, like every other collection read here. An unbounded read grows with
 * signups forever and is billed per document, and nothing on screen uses more
 * than a page of it. Raise the cap rather than removing it.
 */
export async function listUsers(max = 1000): Promise<UserProfile[]> {
  requireCloud("Reading the customer list");
  const { db, collection, getDocs, limit, query } = await firestore();
  const snap = await getDocs(query(collection(db, "users"), limit(max)));
  return snap.docs.map((d) => d.data() as UserProfile);
}

/**
 * One customer.
 *
 * The customer page used to read the entire users collection and find its one
 * person in the result — a per-document charge for every account in the
 * restaurant, on every page view.
 */
export async function getUser(uid: string): Promise<UserProfile | null> {
  requireCloud("Reading a customer");
  const { db, doc, getDoc } = await firestore();
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

// --- Submitting -------------------------------------------------------------

export interface SubmitResult {
  orderId: string;
  mealCount?: number;
  priceIdr?: number;
  deduplicated?: boolean;
}

/**
 * Sends a week to the kitchen.
 *
 * Only the plan id, the week and the delivery choices go over the wire — the
 * function rebuilds everything else from the plan it reads itself, so there is
 * nothing here worth tampering with.
 */
export async function submitWeek(
  planId: string,
  weekNumber: number,
  fulfilment: Record<number, Fulfilment>
): Promise<SubmitResult> {
  requireCloud("Submitting an order");
  const { callApi } = await import("@/lib/api");
  return callApi<SubmitResult>("/api/orders/submit", {
    planId,
    weekNumber,
    fulfilment: Object.fromEntries(
      Object.entries(fulfilment).map(([day, value]) => [String(day), value])
    ),
  });
}
