import type { OrderStatus } from "@/lib/storage/types";

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
