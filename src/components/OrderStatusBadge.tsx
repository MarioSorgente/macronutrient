import type { OrderStatus, PrepStatus } from "@/lib/storage/types";
import Badge, { type BadgeTone } from "@/components/ui/Badge";

/**
 * How far along an order is.
 *
 * Shared between the customer's list and the kitchen board so the two never
 * describe the same state with different words — the single most confusing
 * thing an order system can do.
 */
const ORDER_LABELS: Record<OrderStatus, { label: string; tone: BadgeTone }> = {
  submitted: { label: "Sent", tone: "info" },
  accepted: { label: "Accepted", tone: "verified" },
  in_prep: { label: "In the kitchen", tone: "warning" },
  ready: { label: "Ready", tone: "verified" },
  completed: { label: "Collected", tone: "neutral" },
  rejected: { label: "Rejected", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const PREP_LABELS: Record<PrepStatus, { label: string; tone: BadgeTone }> = {
  todo: { label: "To prep", tone: "neutral" },
  prepping: { label: "Prepping", tone: "warning" },
  ready: { label: "Ready", tone: "verified" },
  done: { label: "Done", tone: "neutral" },
};

export default function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { label, tone } = ORDER_LABELS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function PrepStatusBadge({ status }: { status: PrepStatus }) {
  const { label, tone } = PREP_LABELS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export { ORDER_LABELS, PREP_LABELS };
