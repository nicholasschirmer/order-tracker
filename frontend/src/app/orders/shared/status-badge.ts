import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { OrderStatus } from '../order.model';

@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge" data-testid="status-badge" [attr.data-status]="status()">{{ status() }}</span>`,
  styles: `
    .badge {
      display: inline-block;
      padding: 0.15rem 0.6rem;
      border-radius: 999px;
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      white-space: nowrap;
      background: var(--badge-bg, #e5e7eb);
      color: var(--badge-fg, #374151);
    }
    .badge[data-status='Submitted'] { --badge-bg: #dbeafe; --badge-fg: #1e40af; }
    .badge[data-status='Approved'] { --badge-bg: #e0e7ff; --badge-fg: #3730a3; }
    .badge[data-status='Shipped'] { --badge-bg: #fef3c7; --badge-fg: #92400e; }
    .badge[data-status='Delivered'] { --badge-bg: #dcfce7; --badge-fg: #166534; }
    .badge[data-status='Cancelled'] { --badge-bg: #f3f4f6; --badge-fg: #6b7280; text-decoration: line-through; }
  `,
})
export class StatusBadge {
  readonly status = input.required<OrderStatus>();
}
