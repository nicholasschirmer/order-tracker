/** Mirrors backend/src/OrderTracker.Api/Contracts. */

export type OrderStatus = 'Submitted' | 'Approved' | 'Shipped' | 'Delivered' | 'Cancelled' | 'LostInTransit';

export const ORDER_STATUSES: readonly OrderStatus[] = [
  'Submitted',
  'Approved',
  'Shipped',
  'Delivered',
  'Cancelled',
  'LostInTransit',
];

export interface OrderLine {
  product: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface StatusChange {
  status: OrderStatus;
  changedAt: string;
}

export interface Order {
  id: string;
  clientReference: string;
  customerName: string;
  status: OrderStatus;
  total: number;
  createdAt: string;
  updatedAt: string;
  lines: OrderLine[];
  allowedTransitions: OrderStatus[];
  /** Every status the order has been in, oldest first. */
  statusHistory: StatusChange[];
}

export interface OrderLineRequest {
  product: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateOrderRequest {
  clientReference: string;
  customerName: string;
  lines: OrderLineRequest[];
}

/** RFC 7807 body returned by the API for every error. */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  errors?: Record<string, string[]>;
  clientReference?: string;
  existingOrderId?: string;
  currentStatus?: string;
  requestedStatus?: string;
}

export type CreateOutcome =
  | { kind: 'created'; order: Order }
  | { kind: 'replayed'; order: Order }
  | { kind: 'conflict'; problem: ProblemDetails };

export interface OrderListFilter {
  status?: OrderStatus | '';
  search?: string;
}

/** Shared fixture used by specs. */
export function sampleOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: '6f1c0000-0000-4000-8000-000000000001',
    clientReference: 'PO-100',
    customerName: 'Acme Ltd',
    status: 'Submitted',
    total: 25,
    createdAt: '2026-09-10T09:00:00+00:00',
    updatedAt: '2026-09-10T09:00:00+00:00',
    lines: [{ product: 'Widget', quantity: 10, unitPrice: 2.5, lineTotal: 25 }],
    allowedTransitions: ['Approved', 'Cancelled'],
    statusHistory: [{ status: 'Submitted', changedAt: '2026-09-10T09:00:00+00:00' }],
    ...overrides,
  };
}
