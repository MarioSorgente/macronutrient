import type { OrderStatus, PrepStatus, PrepTask } from "@/lib/storage/types";

export type OrderTransitionActor = "staff" | "client";

/**
 * The complete order lifecycle accepted by the status endpoint.
 *
 * Keeping the actor on each edge makes the exceptional customer cancellation
 * explicit without exposing it as a kitchen action. Empty lists are
 * intentional: completed, rejected and cancelled orders cannot be revived by
 * an ordinary status update.
 */
export const ORDER_TRANSITIONS = {
  submitted: {
    staff: ["accepted", "rejected"],
    client: ["cancelled"],
  },
  accepted: {
    staff: ["in_prep"],
    client: [],
  },
  in_prep: {
    staff: ["ready"],
    client: [],
  },
  ready: {
    staff: ["completed"],
    client: [],
  },
  completed: { staff: [], client: [] },
  rejected: { staff: [], client: [] },
  cancelled: { staff: [], client: [] },
} as const satisfies Record<
  OrderStatus,
  Record<OrderTransitionActor, readonly OrderStatus[]>
>;

export function isOrderTransitionAllowed(
  from: OrderStatus,
  to: OrderStatus,
  actor: OrderTransitionActor
): boolean {
  return (ORDER_TRANSITIONS[from][actor] as readonly OrderStatus[]).includes(to);
}

/**
 * Task progress never changes an order implicitly. It only unlocks the next
 * explicit staff action. Keeping that choice here prevents the task endpoint
 * and order endpoint from developing different lifecycle policies.
 */
export const ORDER_PROGRESS_POLICY = "staff_action" as const;

type TaskState = Pick<PrepTask, "status">;

export interface LifecycleDecision {
  allowed: boolean;
  reason?: string;
}

/** Validate both the lifecycle edge and the aggregate facts represented by its tasks. */
export function orderTransitionDecision(
  from: OrderStatus,
  to: OrderStatus,
  actor: OrderTransitionActor,
  tasks: readonly TaskState[]
): LifecycleDecision {
  if (!isOrderTransitionAllowed(from, to, actor)) {
    return { allowed: false, reason: `An order cannot move from ${from} to ${to}.` };
  }
  if (actor !== "staff") return { allowed: true };

  if (to === "in_prep" && !tasks.some((task) => task.status !== "todo")) {
    return { allowed: false, reason: "Start at least one prep task before marking the order in prep." };
  }
  if (to === "ready" && (tasks.length === 0 || tasks.some((task) => !["ready", "done"].includes(task.status)))) {
    return { allowed: false, reason: "Every prep task must be ready or done before marking the order ready." };
  }
  if (to === "completed" && (tasks.length === 0 || tasks.some((task) => task.status !== "done"))) {
    return { allowed: false, reason: "Every prep task must be done before completing the order." };
  }
  return { allowed: true };
}

/** Orders whose task collection is immutable cannot be changed from the board. */
export function prepTaskTransitionDecision(
  orderStatus: OrderStatus,
  from: PrepStatus,
  to: PrepStatus
): LifecycleDecision {
  const next: Record<PrepStatus, PrepStatus | null> = {
    todo: "prepping", prepping: "ready", ready: "done", done: null,
  };
  if (next[from] !== to) {
    return { allowed: false, reason: `A prep task cannot move from ${from} to ${to}.` };
  }
  if (!["accepted", "in_prep", "ready"].includes(orderStatus)) {
    const terminal = ["cancelled", "rejected", "completed"].includes(orderStatus);
    return {
      allowed: false,
      reason: terminal
        ? "Tasks cannot change after an order is closed."
        : "Accept the order before starting its prep tasks.",
    };
  }
  return { allowed: true };
}
