import { OrderStatus } from '../order.model';

/** Verb shown on the button that moves an order into the given status. */
export const TRANSITION_LABELS: Record<OrderStatus, string> = {
  Submitted: 'Resubmit',
  Approved: 'Approve',
  Shipped: 'Ship',
  Delivered: 'Mark delivered',
  Cancelled: 'Cancel',
};
