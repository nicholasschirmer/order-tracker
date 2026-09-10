import { OrderStatus } from '../order.model';

/** How a status is displayed (badges, filters, timeline). */
export const STATUS_LABELS: Record<OrderStatus, string> = {
  Submitted: 'Submitted',
  Approved: 'Approved',
  Shipped: 'Shipped',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
  LostInTransit: 'Lost in transit',
};

export function statusLabel(status: OrderStatus): string {
  return STATUS_LABELS[status];
}

/** Verb shown on the button that moves an order into the given status. */
export const TRANSITION_LABELS: Record<OrderStatus, string> = {
  Submitted: 'Resubmit',
  Approved: 'Approve',
  Shipped: 'Ship',
  Delivered: 'Mark delivered',
  Cancelled: 'Cancel',
  LostInTransit: 'Mark lost in transit',
};

/** Statuses that end the order unhappily; their buttons are styled as destructive. */
export const DESTRUCTIVE_STATUSES: readonly OrderStatus[] = ['Cancelled', 'LostInTransit'];
