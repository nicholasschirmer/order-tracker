import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { OrderService } from '../order.service';
import { Order, ORDER_STATUSES, OrderStatus } from '../order.model';
import { StatusBadge } from '../shared/status-badge';
import { statusLabel } from '../shared/status-labels';

@Component({
  selector: 'app-order-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, DecimalPipe, StatusBadge],
  templateUrl: './order-list.html',
  styleUrl: './order-list.css',
})
export class OrderList implements OnInit {
  private readonly orders$ = inject(OrderService);

  readonly statuses = ORDER_STATUSES;
  readonly statusLabel = statusLabel;
  readonly status = signal<OrderStatus | ''>('');
  readonly search = signal('');

  readonly orders = signal<Order[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** True when the current result set was produced with a filter or search applied. */
  readonly filtered = signal(false);

  ngOnInit(): void {
    this.load();
  }

  onStatusChange(value: string): void {
    this.status.set(value as OrderStatus | '');
    this.load();
  }

  onSearchInput(value: string): void {
    this.search.set(value);
  }

  onSearchSubmit(event: Event): void {
    event.preventDefault();
    this.load();
  }

  clearFilters(): void {
    this.status.set('');
    this.search.set('');
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    const status = this.status();
    const search = this.search().trim();
    this.filtered.set(status !== '' || search !== '');
    this.orders$.list({ status, search }).subscribe({
      next: (orders) => {
        this.orders.set(orders);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load orders. Check that the API is running and try again.');
        this.loading.set(false);
      },
    });
  }
}
