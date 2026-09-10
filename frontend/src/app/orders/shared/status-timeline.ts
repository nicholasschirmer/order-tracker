import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Order, OrderStatus } from '../order.model';

export type TimelineState = 'done' | 'current' | 'upcoming';

export interface TimelinePoint {
  status: OrderStatus;
  at: string | null;
  state: TimelineState;
}

const HAPPY_PATH: readonly OrderStatus[] = ['Submitted', 'Approved', 'Shipped', 'Delivered'];

/**
 * Vertical timeline of an order's status history: every status it has been in (with a timestamp),
 * the current one highlighted, followed by the steps still ahead on the normal path. A cancelled
 * or delivered order has nothing ahead of it.
 */
@Component({
  selector: 'app-status-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    <ol class="timeline" data-testid="timeline" aria-label="Status timeline">
      @for (p of points(); track p.status + p.state) {
        <li class="point" data-testid="timeline-point" [attr.data-status]="p.status" [attr.data-state]="p.state"
            [attr.aria-current]="p.state === 'current' ? 'step' : null">
          <span class="marker" aria-hidden="true"></span>
          <div class="body">
            <span class="label">{{ p.status }}</span>
            @if (p.at) {
              <time class="when" [attr.datetime]="p.at">{{ p.at | date: 'd MMM y, HH:mm' }}</time>
            } @else {
              <span class="when muted">Pending</span>
            }
          </div>
        </li>
      }
    </ol>
  `,
  styles: `
    .timeline { list-style: none; margin: 0; padding: 0; }
    .point { position: relative; display: flex; gap: 0.75rem; padding: 0 0 1.1rem 0; }
    .point:last-child { padding-bottom: 0; }
    /* connector line */
    .point:not(:last-child)::before {
      content: ''; position: absolute; left: 0.5rem; top: 1.1rem; bottom: 0; width: 2px;
      background: var(--border); transform: translateX(-50%);
    }
    .point[data-state='done']:not(:last-child)::before { background: var(--brand); }
    .point[data-state='current']:not(:last-child)::before,
    .point[data-state='upcoming']:not(:last-child)::before {
      background: repeating-linear-gradient(to bottom, var(--border) 0 4px, transparent 4px 8px);
    }
    .marker {
      flex: none; width: 1rem; height: 1rem; margin-top: 0.15rem; border-radius: 50%;
      border: 2px solid var(--border); background: var(--surface); box-sizing: border-box; position: relative; z-index: 1;
    }
    .point[data-state='done'] .marker { background: var(--brand); border-color: var(--brand); }
    .point[data-state='done'] .marker::after {
      content: ''; position: absolute; inset: 0; margin: auto; width: 0.3rem; height: 0.5rem;
      border: solid #fff; border-width: 0 2px 2px 0; transform: translateY(-1px) rotate(45deg);
    }
    .point[data-state='current'] .marker { border-color: var(--accent); box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.18); }
    .point[data-state='current'] .marker::after {
      content: ''; position: absolute; inset: 0.2rem; border-radius: 50%; background: var(--accent);
    }
    .point[data-state='current'][data-status='Cancelled'] .marker { border-color: var(--danger); box-shadow: 0 0 0 4px rgba(185, 28, 28, 0.15); }
    .point[data-state='current'][data-status='Cancelled'] .marker::after { background: var(--danger); }
    .point[data-state='current'][data-status='Delivered'] .marker { border-color: var(--success-fg); box-shadow: 0 0 0 4px rgba(22, 101, 52, 0.15); }
    .point[data-state='current'][data-status='Delivered'] .marker::after { background: var(--success-fg); }
    .body { display: flex; flex-direction: column; line-height: 1.3; min-width: 0; }
    .label { font-weight: 600; }
    .point[data-state='upcoming'] .label { color: var(--muted); font-weight: 500; }
    .point[data-state='current'] .label { color: var(--accent); }
    .point[data-state='current'][data-status='Cancelled'] .label { color: var(--danger); }
    .point[data-state='current'][data-status='Delivered'] .label { color: var(--success-fg); }
    .when { font-size: 0.82rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  `,
})
export class StatusTimeline {
  readonly order = input.required<Order>();

  readonly points = computed<TimelinePoint[]>(() => {
    const order = this.order();
    let history = order.statusHistory ?? [];
    if (history.length === 0) {
      // Orders created before history was recorded: reconstruct the two facts we do know.
      history =
        order.status === 'Submitted'
          ? [{ status: 'Submitted', changedAt: order.createdAt }]
          : [
              { status: 'Submitted', changedAt: order.createdAt },
              { status: order.status, changedAt: order.updatedAt },
            ];
    }
    const past: TimelinePoint[] = history.map((h, i) => ({
      status: h.status,
      at: h.changedAt,
      state: i === history.length - 1 ? 'current' : 'done',
    }));

    const idx = HAPPY_PATH.indexOf(order.status);
    const ahead: TimelinePoint[] =
      idx === -1 ? [] : HAPPY_PATH.slice(idx + 1).map((status) => ({ status, at: null, state: 'upcoming' }));

    return [...past, ...ahead];
  });
}
