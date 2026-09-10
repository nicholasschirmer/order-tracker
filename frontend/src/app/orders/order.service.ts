import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of, throwError } from 'rxjs';
import { CreateOrderRequest, CreateOutcome, Order, OrderListFilter, OrderStatus } from './order.model';

export const REPLAY_HEADER = 'X-Idempotent-Replay';

@Injectable({ providedIn: 'root' })
export class OrderService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/orders';

  list(filter: OrderListFilter): Observable<Order[]> {
    let params = new HttpParams();
    if (filter.status) params = params.set('status', filter.status);
    const search = filter.search?.trim();
    if (search) params = params.set('search', search);
    return this.http.get<Order[]>(this.base, { params });
  }

  get(id: string): Observable<Order> {
    return this.http.get<Order>(`${this.base}/${id}`);
  }

  /**
   * Submits an order. Never throws for the two "expected" non-success outcomes
   * (idempotent replay, conflicting duplicate) so components can branch on `kind`.
   */
  create(request: CreateOrderRequest): Observable<CreateOutcome> {
    return this.http.post<Order>(this.base, request, { observe: 'response' }).pipe(
      map((response): CreateOutcome => {
        const order = response.body!;
        const replayed = response.status === 200 || response.headers.get(REPLAY_HEADER) === 'true';
        return replayed ? { kind: 'replayed', order } : { kind: 'created', order };
      }),
      catchError((error: HttpErrorResponse) =>
        error.status === 409
          ? of<CreateOutcome>({ kind: 'conflict', problem: error.error ?? {} })
          : throwError(() => error),
      ),
    );
  }

  updateStatus(id: string, status: OrderStatus): Observable<Order> {
    return this.http.patch<Order>(`${this.base}/${id}/status`, { status });
  }
}
