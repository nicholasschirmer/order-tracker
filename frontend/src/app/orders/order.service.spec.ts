import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { OrderService } from './order.service';
import { CreateOutcome, sampleOrder } from './order.model';

describe('OrderService', () => {
  let service: OrderService;
  let http: HttpTestingController;

  const request = {
    clientReference: 'PO-100',
    customerName: 'Acme Ltd',
    lines: [{ product: 'Widget', quantity: 10, unitPrice: 2.5 }],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OrderService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('S01 create() posts the order and reports "created" on 201', async () => {
    const promise = firstValueFrom(service.create(request));

    const req = http.expectOne({ method: 'POST', url: '/api/orders' });
    expect(req.request.body).toEqual(request);
    req.flush(sampleOrder(), { status: 201, statusText: 'Created' });

    const outcome: CreateOutcome = await promise;
    expect(outcome.kind).toBe('created');
    expect(outcome.kind === 'created' && outcome.order.clientReference).toBe('PO-100');
  });

  it('S02 create() reports "replayed" on 200 with X-Idempotent-Replay', async () => {
    const promise = firstValueFrom(service.create(request));

    http
      .expectOne({ method: 'POST', url: '/api/orders' })
      .flush(sampleOrder(), { status: 200, statusText: 'OK', headers: { 'X-Idempotent-Replay': 'true' } });

    const outcome = await promise;
    expect(outcome.kind).toBe('replayed');
    expect(outcome.kind === 'replayed' && outcome.order.id).toBe(sampleOrder().id);
  });

  it('S03 create() reports "conflict" with the problem body on 409 instead of throwing', async () => {
    const promise = firstValueFrom(service.create({ ...request, customerName: 'Globex Inc' }));

    http.expectOne({ method: 'POST', url: '/api/orders' }).flush(
      {
        title: 'Client reference already used',
        detail: "Client reference 'PO-100' was already submitted with different details.",
        status: 409,
        existingOrderId: sampleOrder().id,
      },
      { status: 409, statusText: 'Conflict' },
    );

    const outcome = await promise;
    expect(outcome.kind).toBe('conflict');
    expect(outcome.kind === 'conflict' && outcome.problem.existingOrderId).toBe(sampleOrder().id);
  });

  it('create() still throws for other errors (e.g. 500)', async () => {
    const promise = firstValueFrom(service.create(request));

    http.expectOne({ method: 'POST', url: '/api/orders' }).flush({}, { status: 500, statusText: 'Boom' });

    await expect(promise).rejects.toMatchObject({ status: 500 });
  });

  it('S09 list() with no filter calls GET /api/orders without query params', async () => {
    const promise = firstValueFrom(service.list({}));

    const req = http.expectOne((r) => r.method === 'GET' && r.url === '/api/orders');
    expect(req.request.params.keys()).toEqual([]);
    req.flush([sampleOrder()]);

    expect(await promise).toHaveLength(1);
  });

  it('S11/S12 list() passes status and search as query params, omitting empty ones', async () => {
    const promise = firstValueFrom(service.list({ status: 'Approved', search: 'acme' }));

    const req = http.expectOne((r) => r.method === 'GET' && r.url === '/api/orders');
    expect(req.request.params.get('status')).toBe('Approved');
    expect(req.request.params.get('search')).toBe('acme');
    req.flush([]);
    await promise;

    const promise2 = firstValueFrom(service.list({ status: '', search: '   ' }));
    const req2 = http.expectOne((r) => r.method === 'GET' && r.url === '/api/orders');
    expect(req2.request.params.keys()).toEqual([]);
    req2.flush([]);
    await promise2;
  });

  it('S13 get() fetches a single order by id', async () => {
    const promise = firstValueFrom(service.get('abc'));

    http.expectOne({ method: 'GET', url: '/api/orders/abc' }).flush(sampleOrder({ id: 'abc' }));

    expect((await promise).id).toBe('abc');
  });

  it('S14 updateStatus() PATCHes the status endpoint', async () => {
    const promise = firstValueFrom(service.updateStatus('abc', 'Approved'));

    const req = http.expectOne({ method: 'PATCH', url: '/api/orders/abc/status' });
    expect(req.request.body).toEqual({ status: 'Approved' });
    req.flush(sampleOrder({ id: 'abc', status: 'Approved', allowedTransitions: ['Shipped', 'Cancelled'] }));

    expect((await promise).status).toBe('Approved');
  });
});
