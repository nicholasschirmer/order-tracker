import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { OrderList } from './order-list';
import { sampleOrder } from '../order.model';

describe('OrderList', () => {
  let fixture: ComponentFixture<OrderList>;
  let http: HttpTestingController;

  const el = () => fixture.nativeElement as HTMLElement;
  const rows = () => Array.from(el().querySelectorAll<HTMLElement>('[data-testid="order-row"]'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderList],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(OrderList);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function flushList(orders = [sampleOrder()]) {
    http.expectOne((r) => r.method === 'GET' && r.url === '/api/orders').flush(orders);
  }

  it('shows a loading indicator until the list arrives', async () => {
    expect(el().querySelector('[data-testid="loading"]')).not.toBeNull();
    flushList();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="loading"]')).toBeNull();
  });

  it('S09 renders one row per order in the order returned, with reference, customer, total and status badge', async () => {
    flushList([
      sampleOrder({ id: 'c', clientReference: 'PO-3', customerName: 'Globex Inc', total: 100.01, status: 'Approved' }),
      sampleOrder({ id: 'b', clientReference: 'PO-2' }),
      sampleOrder({ id: 'a', clientReference: 'PO-1' }),
    ]);
    fixture.detectChanges();

    expect(rows()).toHaveLength(3);
    expect(rows()[0].textContent).toContain('PO-3');
    expect(rows()[0].textContent).toContain('Globex Inc');
    expect(rows()[0].textContent).toContain('100.01');
    expect(rows()[2].textContent).toContain('PO-1');

    const badge = rows()[0].querySelector('[data-testid="status-badge"]')!;
    expect(badge.textContent?.trim()).toBe('Approved');
    expect(badge.getAttribute('data-status')).toBe('Approved');

    const link = rows()[0].querySelector<HTMLAnchorElement>('a[data-testid="order-link"]')!;
    expect(link.getAttribute('href')).toBe('/orders/c');
  });

  it('S10 shows an empty state with a link to create the first order', async () => {
    flushList([]);
    fixture.detectChanges();

    expect(rows()).toHaveLength(0);
    const empty = el().querySelector('[data-testid="empty-state"]')!;
    expect(empty).not.toBeNull();
    expect(empty.textContent).toMatch(/no orders/i);
    expect(empty.querySelector('a')?.getAttribute('href')).toBe('/orders/new');
  });

  it('S11 changing the status filter reloads the list with ?status=', async () => {
    flushList();
    fixture.detectChanges();

    const select = el().querySelector<HTMLSelectElement>('[data-testid="status-filter"]')!;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      '',
      'Submitted',
      'Approved',
      'Shipped',
      'Delivered',
      'Cancelled',
    ]);

    select.value = 'Approved';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const req = http.expectOne((r) => r.method === 'GET' && r.url === '/api/orders');
    expect(req.request.params.get('status')).toBe('Approved');
    req.flush([sampleOrder({ status: 'Approved' })]);
    fixture.detectChanges();

    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('[data-testid="status-badge"]')?.textContent?.trim()).toBe('Approved');
  });

  it('S12 submitting the search box reloads the list with ?search=', async () => {
    flushList();
    fixture.detectChanges();

    const input = el().querySelector<HTMLInputElement>('[data-testid="search"]')!;
    input.value = 'acme';
    input.dispatchEvent(new Event('input'));
    input.form!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    const req = http.expectOne((r) => r.method === 'GET' && r.url === '/api/orders');
    expect(req.request.params.get('search')).toBe('acme');
    req.flush([]);
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="empty-state"]')?.textContent).toMatch(/no orders match/i);
  });

  it('shows an error banner when the API fails', async () => {
    http.expectOne((r) => r.url === '/api/orders').flush({ title: 'boom' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="error-banner"]')?.textContent).toMatch(/could not load/i);
  });

  it('does not repeat the "New order" action that already lives in the app header', async () => {
    flushList();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="new-order-link"]')).toBeNull();
    expect(el().querySelectorAll('a[href="/orders/new"]')).toHaveLength(0);
  });
});
