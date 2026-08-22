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
export async function listAllOrders(max = 200): Promise<Order[]> {
  requireCloud("Reading the order book");
  const { db, collection, getDocs, limit, orderBy, query } = await firestore();
  const snap = await getDocs(
    query(collection(db, ORDERS), orderBy("weekStartDate", "desc"), limit(max))
  );
  return snap.docs.map((d) => d.data() as Order);
}

export async function setOrderStatus(
  order: Order,
  status: OrderStatus,
  byUid: string,
  note?: string
): Promise<void> {
  const { db, doc, updateDoc } = await firestore();
  const at = new Date().toISOString();
  await updateDoc(doc(db, ORDERS, order.id), {
    status,
    updatedAt: at,
    ...(note !== undefined ? { restaurantNote: note } : {}),
    statusHistory: [...(order.statusHistory ?? []), { status, at, byUid }],
  });
}

/**
 * Cancels a week the kitchen has not started yet.
 *
 * Only the status moves; a Cloud Function clears the prep tasks and frees the
 * week on the plan, because a customer is not allowed to write the kitchen's
 * board — and should not have to remember to.
 */
export async function cancelOrder(order: Order, byUid: string): Promise<void> {
  const { db, doc, updateDoc } = await firestore();
  const at = new Date().toISOString();
  await updateDoc(doc(db, ORDERS, order.id), {
    status: "cancelled",
    updatedAt: at,
    statusHistory: [
      ...(order.statusHistory ?? []),
      { status: "cancelled", at, byUid },
    ],
  });
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
  byUid: string
): Promise<void> {
  const { db, doc, updateDoc } = await firestore();
  const at = new Date().toISOString();
  await updateDoc(doc(db, PREP_TASKS, taskId), {
    status,
    updatedAt: at,
    ...(status === "done" ? { doneAt: at, doneByUid: byUid } : {}),
  });
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
  const { db, doc, setDoc } = await firestore();
  await setDoc(
    doc(db, "restaurants", RESTAURANT_ID),
    { ...config, updatedAt: new Date().toISOString() },
    { merge: true }
  );
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
  const [{ getFunctionsClient }, { httpsCallable }] = await Promise.all([
    import("@/lib/storage/firebaseFunctions"),
    import("firebase/functions"),
  ]);
  const call = httpsCallable<
    { planId: string; weekNumber: number; fulfilment: Record<string, Fulfilment> },
    SubmitResult
  >(getFunctionsClient(), "submitOrder");

  const result = await call({
    planId,
    weekNumber,
    fulfilment: Object.fromEntries(
      Object.entries(fulfilment).map(([day, value]) => [String(day), value])
    ),
  });
  return result.data;
}
