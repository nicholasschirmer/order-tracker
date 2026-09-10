# Solution Outline

## Problem statement

A sales team needs to record customer purchase orders and track their status. Reps sometimes
resubmit an order because they are unsure whether the first submission succeeded. The system
must not create duplicate orders for the same client-provided reference, and must let users
see what has been submitted and where each order stands.

## Goals

1. Capture an order: client reference, customer name, one or more line items.
2. Guarantee at most one order per client reference (idempotent submission).
3. Track status through a simple, enforced workflow.
4. Let users list, filter and inspect orders.
5. Be simple to run locally: one command for the API, one for the UI.

## Non-goals (for this demo)

* Authentication / authorisation (internal tool, single trusted network assumed).
* Multi-tenant or multi-currency support.
* Editing an order's lines after submission (a new reference would be used instead).
* Production-grade migrations, observability, or deployment pipelines.

## Domain model

```
Order
  Id               Guid            server-generated
  ClientReference  string(64)      required, unique (case-insensitive, trimmed)
  CustomerName     string(200)     required
  Status           OrderStatus     Submitted | Approved | Shipped | Delivered | Cancelled
  CreatedAt        DateTimeOffset  UTC
  UpdatedAt        DateTimeOffset  UTC
  Lines            OrderLine[]     at least one

OrderStatusChange
  Id          int
  Status      OrderStatus
  ChangedAt   DateTimeOffset  UTC — one row per status reached, oldest first

OrderLine
  Id          int
  Product     string(200)   required
  Quantity    int           > 0
  UnitPrice   decimal       >= 0
```

`Order.Total` is computed (`Σ quantity × unitPrice`) and returned in the API, not stored.

## API surface

| Method | Route | Purpose | Success | Errors |
|--------|-------|---------|---------|--------|
| POST | `/api/orders` | Submit an order (idempotent) | 201 new / 200 replay | 400 validation, 409 conflicting duplicate |
| GET | `/api/orders` | List orders, newest first. Optional `?status=` and `?search=` | 200 | 400 bad status |
| GET | `/api/orders/{id}` | Fetch one order | 200 | 404 |
| PATCH | `/api/orders/{id}/status` | Change status `{ "status": "Approved" }` | 200 | 404, 400 unknown status, 422 illegal transition |
| GET | `/health` | Liveness | 200 | — |

Errors use RFC 7807 Problem Details (`application/problem+json`).

### Create order request

```json
{
  "clientReference": "PO-2026-0001",
  "customerName": "Acme Ltd",
  "lines": [
    { "product": "Widget", "quantity": 10, "unitPrice": 2.50 }
  ]
}
```

### Order response

```json
{
  "id": "6f1c…",
  "clientReference": "PO-2026-0001",
  "customerName": "Acme Ltd",
  "status": "Submitted",
  "total": 25.00,
  "createdAt": "2026-09-10T09:00:00Z",
  "updatedAt": "2026-09-10T09:00:00Z",
  "lines": [ { "product": "Widget", "quantity": 10, "unitPrice": 2.50, "lineTotal": 25.00 } ],
  "allowedTransitions": [ "Approved", "Cancelled" ],
  "statusHistory": [ { "status": "Submitted", "changedAt": "2026-09-10T09:00:00Z" } ]
}
```

`allowedTransitions` tells the UI which status buttons to render, so the state machine lives in
one place (the backend) and the frontend never has to duplicate the rules.

## Frontend screens

| Route | Screen | Behaviour |
|-------|--------|-----------|
| `/orders` | Order list | Table of orders (reference, customer, total, status badge, created). Filter by status, search by reference/customer. Empty state when none. Link to create. |
| `/orders/new` | New order | Form: client reference, customer, dynamic line items. Client-side validation. On 201 → success toast, navigate to detail. On 200 replay → info banner "already submitted", navigate to detail. On 409 → error banner explaining the reference is taken with different details. |
| `/orders/:id` | Order detail | Full order, lines, total, a status timeline (past statuses with timestamps, current highlighted, remaining steps pending), buttons for each *allowed* next status only. |

## Project layout

```
order-tracker/
├── README.md
├── docs/
│   ├── architecture.md
│   ├── solution-outline.md
│   └── scenarios.md
├── backend/
│   ├── OrderTracker.slnx
│   ├── src/OrderTracker.Api/          ASP.NET Core Minimal API + EF Core SQLite
│   └── tests/OrderTracker.Api.Tests/  xUnit domain + HTTP scenario tests
└── frontend/
    ├── src/app/orders/                order.model.ts, order.service.ts, order-list/, new-order/,
    │                                  order-detail/, shared/ (Vitest specs beside each file)
    ├── e2e/                           Playwright specs, helpers.ts, screenshots/
    ├── playwright.config.ts           boots API (fresh SQLite) + ng serve, single worker
    └── proxy.conf.json                /api → http://localhost:5080
```

## Development approach

Strict test-driven development, in this order:

1. **Design docs** (this folder) — fix the scenarios before writing code.
2. **Backend**: for each scenario write a failing xUnit test, implement the minimum to pass,
   refactor. Domain rules first, then HTTP endpoints via `WebApplicationFactory`.
3. **Frontend**: for each screen write failing Vitest specs (service, then components),
   implement, refactor. The API contract is already fixed by the backend tests.
4. **End-to-end**: Playwright specs exercise the real stack and capture screenshots of every
   screen and state, which are reviewed for layout/formatting.
5. README is updated at the end of each phase.
