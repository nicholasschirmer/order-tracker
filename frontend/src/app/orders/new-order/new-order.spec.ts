import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { NewOrder } from './new-order';
import { sampleOrder } from '../order.model';

describe('NewOrder', () => {
  let fixture: ComponentFixture<NewOrder>;
  let http: HttpTestingController;
  let router: Router;

  const el = () => fixture.nativeElement as HTMLElement;
  const submit = () => el().querySelector<HTMLButtonElement>('[data-testid="submit"]')!;
  const lineRows = () => Array.from(el().querySelectorAll<HTMLElement>('[data-testid="line-row"]'));
  const fieldErrors = () => Array.from(el().querySelectorAll<HTMLElement>('.field-error')).map((e) => e.textContent?.trim());

  async function type(selector: string, value: string, root: ParentNode = el()) {
    const input = root.querySelector<HTMLInputElement>(selector)!;
    expect(input, `missing input ${selector}`).not.toBeNull();
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
  }

  async function fillValidOrder() {
    await type('#clientReference', 'PO-100');
    await type('#customerName', 'Acme Ltd');
    const row = lineRows()[0];
    await type('[data-testid="line-product"]', 'Widget', row);
    await type('[data-testid="line-quantity"]', '10', row);
    await type('[data-testid="line-unit-price"]', '2.50', row);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewOrder],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(NewOrder);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('starts with one empty line row and a disabled submit button', () => {
    expect(lineRows()).toHaveLength(1);
    expect(submit().disabled).toBe(true);
  });

  it('S06 shows inline validation for required fields after they are touched and keeps submit disabled', async () => {
    await type('#clientReference', '');
    await type('#customerName', '   ');

    expect(fieldErrors()).toEqual(expect.arrayContaining([expect.stringMatching(/client reference is required/i)]));
    expect(fieldErrors()).toEqual(expect.arrayContaining([expect.stringMatching(/customer name is required/i)]));
    expect(submit().disabled).toBe(true);
  });

  it('S07 validates line items: product required, quantity > 0, unit price >= 0', async () => {
    await type('#clientReference', 'PO-1');
    await type('#customerName', 'Acme');
    const row = lineRows()[0];
    await type('[data-testid="line-product"]', '', row);
    await type('[data-testid="line-quantity"]', '0', row);
    await type('[data-testid="line-unit-price"]', '-1', row);

    expect(fieldErrors()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/product is required/i),
        expect.stringMatching(/quantity must be greater than zero/i),
        expect.stringMatching(/unit price cannot be negative/i),
      ]),
    );
    expect(submit().disabled).toBe(true);
  });

  it('can add and remove line rows, never dropping below one', async () => {
    el().querySelector<HTMLButtonElement>('[data-testid="add-line"]')!.click();
    fixture.detectChanges();
    expect(lineRows()).toHaveLength(2);

    lineRows()[1].querySelector<HTMLButtonElement>('[data-testid="remove-line"]')!.click();
    fixture.detectChanges();
    expect(lineRows()).toHaveLength(1);

    expect(lineRows()[0].querySelector<HTMLButtonElement>('[data-testid="remove-line"]')!.disabled).toBe(true);
  });

  it('shows a running total as lines are filled in', async () => {
    await fillValidOrder();
    expect(el().querySelector('[data-testid="running-total"]')?.textContent).toContain('25.00');
  });

  it('S01 posts the order and navigates to the detail page with a "created" notice', async () => {
    await fillValidOrder();
    expect(submit().disabled).toBe(false);

    submit().click();
    fixture.detectChanges();

    const req = http.expectOne({ method: 'POST', url: '/api/orders' });
    expect(req.request.body).toEqual({
      clientReference: 'PO-100',
      customerName: 'Acme Ltd',
      lines: [{ product: 'Widget', quantity: 10, unitPrice: 2.5 }],
    });
    req.flush(sampleOrder({ id: 'new-id' }), { status: 201, statusText: 'Created' });
    fixture.detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(['/orders', 'new-id'], { queryParams: { notice: 'created' } });
  });

  it('S02 on an idempotent replay navigates to the existing order with a "replayed" notice', async () => {
    await fillValidOrder();
    submit().click();
    fixture.detectChanges();

    http
      .expectOne({ method: 'POST', url: '/api/orders' })
      .flush(sampleOrder({ id: 'existing-id' }), { status: 200, statusText: 'OK', headers: { 'X-Idempotent-Replay': 'true' } });
    fixture.detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(['/orders', 'existing-id'], { queryParams: { notice: 'replayed' } });
  });

  it('S03 on a conflict shows an error banner with a link to the existing order and stays on the form', async () => {
    await fillValidOrder();
    submit().click();
    fixture.detectChanges();

    http.expectOne({ method: 'POST', url: '/api/orders' }).flush(
      {
        title: 'Client reference already used',
        detail: "Client reference 'PO-100' was already submitted with different details.",
        status: 409,
        clientReference: 'PO-100',
        existingOrderId: 'existing-id',
      },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();

    const banner = el().querySelector('[data-testid="error-banner"]')!;
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('PO-100');
    expect(banner.textContent).toMatch(/different details/i);
    expect(banner.querySelector('a')?.getAttribute('href')).toBe('/orders/existing-id');
    expect(router.navigate).not.toHaveBeenCalled();
    expect(submit().disabled).toBe(false);
  });

  it('disables submit while the request is in flight', async () => {
    await fillValidOrder();
    submit().click();
    fixture.detectChanges();

    expect(submit().disabled).toBe(true);
    http.expectOne({ method: 'POST', url: '/api/orders' }).flush(sampleOrder(), { status: 201, statusText: 'Created' });
    fixture.detectChanges();
  });

  it('shows a generic error banner on unexpected failures', async () => {
    await fillValidOrder();
    submit().click();
    fixture.detectChanges();

    http.expectOne({ method: 'POST', url: '/api/orders' }).flush({}, { status: 500, statusText: 'Boom' });
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="error-banner"]')?.textContent).toMatch(/could not be submitted/i);
    expect(submit().disabled).toBe(false);
  });
});
