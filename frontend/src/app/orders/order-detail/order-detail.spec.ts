import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { OrderDetail } from './order-detail';
import { sampleOrder } from '../order.model';

describe('OrderDetail', () => {
  let fixture: ComponentFixture<OrderDetail>;
  let http: HttpTestingController;

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (testid: string) => el().querySelector(`[data-testid="${testid}"]`)?.textContent?.trim();
  const transitionButtons = () =>
    Array.from(el().querySelectorAll<HTMLButtonElement>('[data-testid^="transition-"]')).map((b) => b.textContent?.trim());

  async function create(id = 'abc', notice?: string) {
    fixture = TestBed.createComponent(OrderDetail);
    fixture.componentRef.setInput('id', id);
    if (notice) fixture.componentRef.setInput('notice', notice);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderDetail],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('S13 loads the order by id and renders reference, customer, lines, total and status', async () => {
    await create('abc');

    http.expectOne({ method: 'GET', url: '/api/orders/abc' }).flush(
      sampleOrder({
        id: 'abc',
        clientReference: 'PO-200',
        customerName: 'Globex Inc',
        total: 100.01,
        lines: [
          { product: 'Gadget', quantity: 1, unitPrice: 99.99, lineTotal: 99.99 },
          { product: 'Gizmo', quantity: 2, unitPrice: 0.01, lineTotal: 0.02 },
        ],
      }),
    );
    fixture.detectChanges();

    expect(text('detail-reference')).toBe('PO-200');
    expect(text('detail-customer')).toBe('Globex Inc');
    expect(text('detail-total')).toContain('100.01');
    expect(text('status-badge')).toBe('Submitted');
    const lines = el().querySelectorAll('[data-testid="line-row"]');
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toContain('Gadget');
    expect(lines[0].textContent).toContain('99.99');
    expect(lines[1].textContent).toContain('Gizmo');
  });

  it('S13 shows a not-found message for an unknown id', async () => {
    await create('missing');

    http
      .expectOne({ method: 'GET', url: '/api/orders/missing' })
      .flush({ title: 'Order not found', status: 404 }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="error-banner"]')?.textContent).toMatch(/not found/i);
    expect(el().querySelector('a[href="/orders"]')).not.toBeNull();
  });

  it('S16 renders a button only for each allowed transition', async () => {
    await create('abc');
    http.expectOne({ url: '/api/orders/abc', method: 'GET' }).flush(sampleOrder({ id: 'abc' }));
    fixture.detectChanges();

    expect(transitionButtons()).toEqual(['Approve', 'Cancel']);
    expect(el().querySelector('[data-testid="transition-Approved"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="transition-Shipped"]')).toBeNull();
  });

  it('S23 a shipped order offers "Mark delivered" and a destructive "Mark lost in transit"', async () => {
    await create('abc');
    http
      .expectOne({ url: '/api/orders/abc', method: 'GET' })
      .flush(sampleOrder({ id: 'abc', status: 'Shipped', allowedTransitions: ['Delivered', 'LostInTransit'] }));
    fixture.detectChanges();

    expect(transitionButtons()).toEqual(['Mark delivered', 'Mark lost in transit']);
    const lost = el().querySelector<HTMLButtonElement>('[data-testid="transition-LostInTransit"]')!;
    expect(lost.classList.contains('btn-danger')).toBe(true);
    expect(el().querySelector('[data-testid="transition-Delivered"]')?.classList.contains('btn-primary')).toBe(true);
  });

  it('S23 marking an order lost in transit PATCHes LostInTransit and renders the terminal state', async () => {
    await create('abc');
    http
      .expectOne({ url: '/api/orders/abc', method: 'GET' })
      .flush(sampleOrder({ id: 'abc', status: 'Shipped', allowedTransitions: ['Delivered', 'LostInTransit'] }));
    fixture.detectChanges();

    el().querySelector<HTMLButtonElement>('[data-testid="transition-LostInTransit"]')!.click();
    fixture.detectChanges();
    const patch = http.expectOne({ method: 'PATCH', url: '/api/orders/abc/status' });
    expect(patch.request.body).toEqual({ status: 'LostInTransit' });
    patch.flush(
      sampleOrder({
        id: 'abc',
        status: 'LostInTransit',
        allowedTransitions: [],
        statusHistory: [
          { status: 'Submitted', changedAt: '2026-09-10T09:00:00+00:00' },
          { status: 'Approved', changedAt: '2026-09-10T10:00:00+00:00' },
          { status: 'Shipped', changedAt: '2026-09-11T08:00:00+00:00' },
          { status: 'LostInTransit', changedAt: '2026-09-20T08:00:00+00:00' },
        ],
      }),
    );
    fixture.detectChanges();

    expect(text('status-badge')).toBe('Lost in transit');
    expect(el().querySelector('[data-testid="status-badge"]')?.getAttribute('data-status')).toBe('LostInTransit');
    expect(transitionButtons()).toEqual([]);
    expect(el().querySelector('[data-testid="terminal-note"]')?.textContent).toMatch(/lost in transit/i);
    expect(el().querySelector('[data-testid="notice"]')?.textContent).toMatch(/status changed to lost in transit/i);
    expect(pointSummary()).toEqual(['Submitted:done', 'Approved:done', 'Shipped:done', 'LostInTransit:current']);
    expect(points().at(-1)?.textContent).toContain('Lost in transit');
  });

  it('S16 shows a terminal message and no buttons for Delivered orders', async () => {
    await create('abc');
    http
      .expectOne({ url: '/api/orders/abc', method: 'GET' })
      .flush(sampleOrder({ id: 'abc', status: 'Delivered', allowedTransitions: [] }));
    fixture.detectChanges();

    expect(transitionButtons()).toEqual([]);
    expect(el().querySelector('[data-testid="terminal-note"]')?.textContent).toMatch(/no further changes/i);
  });

  it('S14 clicking Approve PATCHes the status and re-renders with the new status and buttons', async () => {
    await create('abc');
    http.expectOne({ url: '/api/orders/abc', method: 'GET' }).flush(sampleOrder({ id: 'abc' }));
    fixture.detectChanges();

    el().querySelector<HTMLButtonElement>('[data-testid="transition-Approved"]')!.click();
    fixture.detectChanges();

    const patch = http.expectOne({ method: 'PATCH', url: '/api/orders/abc/status' });
    expect(patch.request.body).toEqual({ status: 'Approved' });
    patch.flush(sampleOrder({ id: 'abc', status: 'Approved', allowedTransitions: ['Shipped', 'Cancelled'] }));
    fixture.detectChanges();

    expect(text('status-badge')).toBe('Approved');
    expect(transitionButtons()).toEqual(['Ship', 'Cancel']);
    expect(el().querySelector('[data-testid="notice"]')?.textContent).toMatch(/status changed to approved/i);
  });

  it('shows the API problem detail when a transition is rejected', async () => {
    await create('abc');
    http.expectOne({ url: '/api/orders/abc', method: 'GET' }).flush(sampleOrder({ id: 'abc' }));
    fixture.detectChanges();

    el().querySelector<HTMLButtonElement>('[data-testid="transition-Approved"]')!.click();
    fixture.detectChanges();
    http
      .expectOne({ method: 'PATCH', url: '/api/orders/abc/status' })
      .flush(
        { title: 'Illegal status transition', detail: 'An order in status Submitted cannot be changed to Approved.', status: 422 },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="error-banner"]')?.textContent).toContain(
      'An order in status Submitted cannot be changed to Approved.',
    );
    expect(text('status-badge')).toBe('Submitted');
  });

  it('S01 shows a success notice when arriving with ?notice=created', async () => {
    await create('abc', 'created');
    http.expectOne({ url: '/api/orders/abc', method: 'GET' }).flush(sampleOrder({ id: 'abc' }));
    fixture.detectChanges();

    const notice = el().querySelector('[data-testid="notice"]')!;
    expect(notice.textContent).toMatch(/order submitted/i);
    expect(notice.getAttribute('data-kind')).toBe('success');
  });

  it('S02 shows an "already submitted" notice when arriving with ?notice=replayed', async () => {
    await create('abc', 'replayed');
    http.expectOne({ url: '/api/orders/abc', method: 'GET' }).flush(sampleOrder({ id: 'abc' }));
    fixture.detectChanges();

    const notice = el().querySelector('[data-testid="notice"]')!;
    expect(notice.textContent).toMatch(/already been submitted/i);
    expect(notice.textContent).toMatch(/no duplicate/i);
    expect(notice.getAttribute('data-kind')).toBe('info');
  });

  const points = () => Array.from(el().querySelectorAll<HTMLElement>('[data-testid="timeline-point"]'));
  const pointSummary = () => points().map((p) => `${p.dataset['status']}:${p.dataset['state']}`);

  it('S22 renders a timeline point per status: past and current with times, remaining steps upcoming', async () => {
    await create('abc');
    http.expectOne({ url: '/api/orders/abc', method: 'GET' }).flush(
      sampleOrder({
        id: 'abc',
        status: 'Shipped',
        allowedTransitions: ['Delivered'],
        statusHistory: [
          { status: 'Submitted', changedAt: '2026-09-10T09:00:00+00:00' },
          { status: 'Approved', changedAt: '2026-09-10T10:30:00+00:00' },
          { status: 'Shipped', changedAt: '2026-09-11T08:00:00+00:00' },
        ],
      }),
    );
    fixture.detectChanges();

    expect(pointSummary()).toEqual(['Submitted:done', 'Approved:done', 'Shipped:current', 'Delivered:upcoming']);
    expect(points()[0].querySelector('time')?.getAttribute('datetime')).toBe('2026-09-10T09:00:00+00:00');
    expect(points()[2].querySelector('time')).not.toBeNull();
    expect(points()[3].querySelector('time')).toBeNull();
    expect(points()[3].textContent).toMatch(/pending/i);
  });

  it('S22 a fresh order shows Submitted as current with the three remaining steps upcoming', async () => {
    await create('abc');
    http.expectOne({ url: '/api/orders/abc', method: 'GET' }).flush(sampleOrder({ id: 'abc' }));
    fixture.detectChanges();

    expect(pointSummary()).toEqual(['Submitted:current', 'Approved:upcoming', 'Shipped:upcoming', 'Delivered:upcoming']);
  });

  it('S22 a cancelled order ends its timeline at Cancelled with no upcoming steps', async () => {
    await create('abc');
    http.expectOne({ url: '/api/orders/abc', method: 'GET' }).flush(
      sampleOrder({
        id: 'abc',
        status: 'Cancelled',
        allowedTransitions: [],
        statusHistory: [
          { status: 'Submitted', changedAt: '2026-09-10T09:00:00+00:00' },
          { status: 'Approved', changedAt: '2026-09-10T10:30:00+00:00' },
          { status: 'Cancelled', changedAt: '2026-09-12T08:00:00+00:00' },
        ],
      }),
    );
    fixture.detectChanges();

    expect(pointSummary()).toEqual(['Submitted:done', 'Approved:done', 'Cancelled:current']);
  });

  it('S22 the timeline grows after a transition', async () => {
    await create('abc');
    http.expectOne({ url: '/api/orders/abc', method: 'GET' }).flush(sampleOrder({ id: 'abc' }));
    fixture.detectChanges();
    expect(pointSummary()[0]).toBe('Submitted:current');

    el().querySelector<HTMLButtonElement>('[data-testid="transition-Approved"]')!.click();
    fixture.detectChanges();
    http.expectOne({ method: 'PATCH', url: '/api/orders/abc/status' }).flush(
      sampleOrder({
        id: 'abc',
        status: 'Approved',
        allowedTransitions: ['Shipped', 'Cancelled'],
        statusHistory: [
          { status: 'Submitted', changedAt: '2026-09-10T09:00:00+00:00' },
          { status: 'Approved', changedAt: '2026-09-10T10:30:00+00:00' },
        ],
      }),
    );
    fixture.detectChanges();

    expect(pointSummary()).toEqual(['Submitted:done', 'Approved:current', 'Shipped:upcoming', 'Delivered:upcoming']);
  });

  it('has a back link to the order list', async () => {
    await create('abc');
    http.expectOne({ url: '/api/orders/abc', method: 'GET' }).flush(sampleOrder({ id: 'abc' }));
    fixture.detectChanges();

    expect(el().querySelector('a[data-testid="back-link"]')?.getAttribute('href')).toBe('/orders');
  });
});
