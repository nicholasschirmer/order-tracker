import { TestBed } from '@angular/core/testing';
import { StatusBadge } from './status-badge';
import { ORDER_STATUSES } from '../order.model';

describe('StatusBadge', () => {
  it('shows a human-readable label and keeps the raw status in data-status', () => {
    const fixture = TestBed.createComponent(StatusBadge);
    fixture.componentRef.setInput('status', 'LostInTransit');
    fixture.detectChanges();

    const badge = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="status-badge"]')!;
    expect(badge.textContent?.trim()).toBe('Lost in transit');
    expect(badge.getAttribute('data-status')).toBe('LostInTransit');
  });

  it('has a label for every status', () => {
    for (const status of ORDER_STATUSES) {
      const fixture = TestBed.createComponent(StatusBadge);
      fixture.componentRef.setInput('status', status);
      fixture.detectChanges();
      const label = (fixture.nativeElement as HTMLElement).textContent?.trim();
      expect(label, status).toBeTruthy();
      expect(label, status).not.toMatch(/[a-z][A-Z]/); // no raw camelCase leaks into the UI
    }
  });
});
