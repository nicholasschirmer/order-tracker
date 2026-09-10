import { ChangeDetectionStrategy, Component, effect, inject, input, linkedSignal, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { OrderService } from '../order.service';
import { Order, OrderStatus } from '../order.model';
import { StatusBadge } from '../shared/status-badge';
import { StatusTimeline } from '../shared/status-timeline';
import { TRANSITION_LABELS } from '../shared/status-labels';

interface Notice {
  kind: 'success' | 'info';
  text: string;
}

const NOTICES: Record<string, Notice> = {
  created: { kind: 'success', text: 'Order submitted. It is now recorded and visible to the whole team.' },
  replayed: {
    kind: 'info',
    text: 'This order had already been submitted — no duplicate was created. You are looking at the existing order.',
  },
};

@Component({
  selector: 'app-order-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DecimalPipe, StatusBadge, StatusTimeline],
  templateUrl: './order-detail.html',
  styleUrl: './order-detail.css',
})
export class OrderDetail {
  private readonly orders = inject(OrderService);

  /** Bound from the route parameter via withComponentInputBinding(). */
  readonly id = input.required<string>();
  /** Bound from the ?notice= query parameter set by the New Order screen. */
  readonly notice = input<string>();

  readonly order = signal<Order | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notFound = signal(false);
  readonly updating = signal<OrderStatus | null>(null);
  readonly banner = linkedSignal<Notice | null>(() => (this.notice() ? NOTICES[this.notice()!] ?? null : null));

  readonly labels = TRANSITION_LABELS;

  constructor() {
    effect(() => this.load(this.id()));
  }

  load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.notFound.set(false);
    this.orders.get(id).subscribe({
      next: (order) => {
        this.order.set(order);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        if (err.status === 404) {
          this.notFound.set(true);
          this.error.set('Order not found. It may have been created on a different environment.');
        } else {
          this.error.set('The order could not be loaded. Please try again.');
        }
      },
    });
  }

  transition(status: OrderStatus): void {
    const order = this.order();
    if (!order || this.updating()) return;
    this.updating.set(status);
    this.error.set(null);
    this.orders.updateStatus(order.id, status).subscribe({
      next: (updated) => {
        this.order.set(updated);
        this.updating.set(null);
        this.banner.set({ kind: 'success', text: `Status changed to ${updated.status}.` });
      },
      error: (err: HttpErrorResponse) => {
        this.updating.set(null);
        this.error.set(err.error?.detail ?? err.error?.title ?? 'The status could not be changed.');
      },
    });
  }

  isDestructive(status: OrderStatus): boolean {
    return status === 'Cancelled';
  }
}
