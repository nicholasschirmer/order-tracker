# Scenarios

Each scenario is written Given/When/Then and has an identifier used in test names
(`S01_…`) so coverage can be traced from doc → backend test → frontend test → e2e test.

Legend for the *Tested by* column: **B** = backend xUnit, **F** = frontend Vitest, **E** = Playwright e2e.

---

## Order submission

### S01 — Submit a valid new order
* **Given** no order exists with reference `PO-100`
* **When** a rep submits `PO-100` for "Acme Ltd" with one line (Widget × 10 @ 2.50)
* **Then** the API responds `201 Created`, the body has a server id, status `Submitted`,
  total `25.00`, and a `Location` header pointing at the new order
* **Tested by:** B, F, E

### S02 — Resubmit the identical order (idempotent replay)
* **Given** `PO-100` was already submitted as in S01
* **When** the same payload is submitted again
* **Then** the API responds `200 OK` with the *original* order (same id), header
  `X-Idempotent-Replay: true`, and only one order exists in the database
* **And** the UI tells the rep the order was already submitted and shows the existing order
* **Tested by:** B, F, E

### S03 — Resubmit the same reference with different details (conflict)
* **Given** `PO-100` exists for "Acme Ltd"
* **When** `PO-100` is submitted for "Globex Inc" (or with different lines)
* **Then** the API responds `409 Conflict` with a Problem Details body naming the reference,
  no new order is created and the existing order is unchanged
* **And** the UI shows an error explaining the reference is already used with different details
* **Tested by:** B, F, E

### S04 — Reference matching is case-insensitive and trims whitespace
* **Given** `PO-100` exists
* **When** `  po-100 ` is submitted with the identical payload
* **Then** it is treated as a replay of `PO-100` (200, same id)
* **Tested by:** B

### S05 — Concurrent submissions of the same reference create one order
* **Given** no order exists with reference `PO-RACE`
* **When** 10 identical requests are sent in parallel
* **Then** exactly one order exists afterwards, exactly one response is `201`, and the rest
  are `200` replays with the same id
* **Tested by:** B

### S06 — Reject an order with missing required fields
* **When** a request omits `clientReference`, or `customerName`, or has an empty `lines` array
* **Then** the API responds `400 Bad Request` with a Problem Details body listing each invalid
  field, and nothing is stored
* **And** the UI disables Submit / shows inline validation until the fields are filled
* **Tested by:** B, F, E

### S07 — Reject invalid line items
* **When** a line has `quantity <= 0`, or `unitPrice < 0`, or blank `product`
* **Then** the API responds `400` naming the offending line index
* **Tested by:** B, F

### S08 — Reference length is bounded
* **When** `clientReference` is longer than 64 characters
* **Then** the API responds `400`
* **Tested by:** B

---

## Viewing orders

### S09 — List orders newest first
* **Given** three orders were created in sequence
* **When** `GET /api/orders` is called
* **Then** all three are returned, most recently created first, each with its total and status
* **And** the UI table shows them in the same order with a status badge
* **Tested by:** B, F, E

### S10 — Empty list
* **Given** no orders exist
* **When** the list is requested
* **Then** the API returns `200` with `[]` and the UI shows an empty-state message with a link to
  create the first order
* **Tested by:** B, F, E

### S11 — Filter list by status
* **Given** orders in `Submitted` and `Approved` status
* **When** `GET /api/orders?status=Approved`
* **Then** only approved orders are returned; an unknown status value yields `400`
* **And** the UI status dropdown applies the filter
* **Tested by:** B, F, E

### S12 — Search list by reference or customer
* **Given** orders for "Acme Ltd" (`PO-100`) and "Globex Inc" (`PO-200`)
* **When** `GET /api/orders?search=acme` or `?search=200`
* **Then** only the matching order is returned (case-insensitive substring on reference or
  customer name)
* **Tested by:** B, F

### S13 — Fetch a single order
* **Given** an order exists
* **When** `GET /api/orders/{id}`
* **Then** the full order with lines is returned; an unknown id yields `404`
* **And** the UI detail page shows reference, customer, each line, total and status
* **Tested by:** B, F, E

---

## Status tracking

### S14 — Valid status transition
* **Given** an order in `Submitted`
* **When** `PATCH /api/orders/{id}/status` with `{ "status": "Approved" }`
* **Then** `200` with status `Approved` and an `updatedAt` later than `createdAt`
* **And** the UI detail page shows the new status after clicking **Approve**
* **Tested by:** B, F, E

### S15 — Full happy path Submitted → Approved → Shipped → Delivered
* **When** each transition is applied in turn
* **Then** each succeeds and the final status is `Delivered`
* **Tested by:** B, E

### S16 — Illegal status transition is rejected
* **Given** an order in a terminal status (`Delivered`, `Cancelled` or `LostInTransit`)
* **When** any further transition is attempted, or `Submitted → Shipped` is attempted
* **Then** `422 Unprocessable Entity` with a Problem Details body naming the current and
  requested status, and the order is unchanged
* **And** the UI only offers buttons for legal next statuses
* **Tested by:** B, F

### S17 — Cancel from Submitted or Approved
* **Given** an order in `Submitted` or `Approved`
* **When** transitioned to `Cancelled`
* **Then** `200` and status `Cancelled`; it can no longer be changed
* **Tested by:** B, E

### S18 — Unknown status value
* **When** `PATCH …/status` with `{ "status": "Lost" }`
* **Then** `400 Bad Request`
* **Tested by:** B

### S19 — Status change on unknown order
* **When** `PATCH /api/orders/{random guid}/status`
* **Then** `404 Not Found`
* **Tested by:** B

### S22 — Status timeline
* **Given** an order that has moved Submitted → Approved → Shipped
* **When** the order is fetched
* **Then** the API returns `statusHistory` with one entry per status reached, oldest first, each
  with the time it was reached; the first entry is always `Submitted` at `createdAt` and the last
  matches `status`/`updatedAt`; rejected transitions add nothing
* **And** the UI detail page shows a timeline with a point per status: past points ticked with
  their time, the current point highlighted, and the remaining happy-path steps (here `Delivered`)
  shown as pending. Terminal orders (`Delivered`, `Cancelled`, `LostInTransit`) show no pending steps
* **Tested by:** B, F, E

### S23 — Mark a shipped order lost in transit
* **Given** an order in `Shipped`
* **When** `PATCH /api/orders/{id}/status` with `{ "status": "LostInTransit" }`
* **Then** `200`, status `LostInTransit`, `allowedTransitions` is empty and every further
  transition returns `422`. `LostInTransit` is rejected with `422` from any status other than
  `Shipped`. `GET /api/orders?status=LostInTransit` filters to such orders
* **And** the UI detail page for a shipped order offers **Mark delivered** and a destructive
  **Mark lost in transit** button; after clicking, the badge reads "Lost in transit", the timeline
  ends on a red terminal point and no actions remain. The list filter lists "Lost in transit"
* **Tested by:** B, F, E

---

## Operability

### S20 — Health endpoint
* **When** `GET /health`
* **Then** `200` with body `Healthy`
* **Tested by:** B, E

### S21 — Frontend layout is well formatted
* **When** each screen (list, empty list, new-order form with validation errors, detail) is
  rendered at desktop (1280×800) and mobile (390×844) widths
* **Then** Playwright screenshots are captured under `frontend/e2e/screenshots/` and no element
  overflows the viewport horizontally
* **Tested by:** E

---

## Traceability matrix

| Scenario | Backend test | Frontend test | E2E test |
|----------|--------------|---------------|----------|
| S01 | `OrdersApiTests.S01_*` | `new-order.spec.ts`, `order.service.spec.ts`, `order-detail.spec.ts` (notice) | `orders.spec.ts › S01` |
| S02 | `OrdersApiTests.S02_*`, `OrderServiceDuplicateTests` | `new-order.spec.ts`, `order.service.spec.ts`, `order-detail.spec.ts` (notice) | `orders.spec.ts › S02` |
| S03 | `OrdersApiTests.S03_*`, `OrderServiceDuplicateTests` | `new-order.spec.ts`, `order.service.spec.ts` | `orders.spec.ts › S03` |
| S04 | `OrderTests.S04_*`, `OrdersApiTests.S04_*`, `OrderServiceDuplicateTests` | — | — |
| S05 | `OrdersApiTests.S05_*`, `OrderServiceDuplicateTests` (deterministic race via interceptor + 12-way parallel) | — | — |
| S06 | `OrdersApiTests.S06_*` (×2) | `new-order.spec.ts` | `orders.spec.ts › S06` |
| S07 | `OrdersApiTests.S07_*` | `new-order.spec.ts` | — |
| S08 | `OrdersApiTests.S08_*` (×2) | — | — |
| S09 | `OrdersApiTests.S09_*` | `order-list.spec.ts`, `order.service.spec.ts` | `orders.spec.ts › S09` |
| S10 | `OrdersApiTests.S10_*` | `order-list.spec.ts` | `01-empty-state.spec.ts › S10` |
| S11 | `OrdersApiTests.S11_*` (×2) | `order-list.spec.ts`, `order.service.spec.ts` | `orders.spec.ts › S11` |
| S12 | `OrdersApiTests.S12_*` | `order-list.spec.ts`, `order.service.spec.ts` | `orders.spec.ts › S12` |
| S13 | `OrdersApiTests.S13_*` (×2) | `order-detail.spec.ts`, `order.service.spec.ts` | `orders.spec.ts › S13` |
| S14 | `OrderTests.S14_*`, `OrdersApiTests.S14_*` | `order-detail.spec.ts`, `order.service.spec.ts` | `orders.spec.ts › S14` |
| S15 | `OrdersApiTests.S15_*` | — | `orders.spec.ts › S15` |
| S16 | `OrderTests.S16_*`, `OrdersApiTests.S16_*` (×2) | `order-detail.spec.ts` | — |
| S17 | `OrderTests.S17_*`, `OrdersApiTests.S17_*` | — | `orders.spec.ts › S17` |
| S18 | `OrdersApiTests.S18_*` | — | — |
| S19 | `OrdersApiTests.S19_*` | — | — |
| S20 | `OrdersApiTests.S20_*` | — | `01-empty-state.spec.ts › S20` |
| S21 | — | — | `layout.spec.ts` (6 tests: 3 screens × 2 viewports) |
| S22 | `OrderTests.S22_*` (×3), `OrdersApiTests.S22_*` (×2), `DataSeederTests` | `order-detail.spec.ts` (×4) | `orders.spec.ts › S14, S15, S17` |
| S23 | `OrderTests.S23_*`, `OrderTests.S14_S17_*`/`S16_*` rows, `OrdersApiTests.S23_*` (×2), `OrdersApiTests.S16_*` row | `order-detail.spec.ts` (×2), `status-badge.spec.ts`, `order-list.spec.ts` | `orders.spec.ts › S23` |

Backend tests: `backend/tests/OrderTracker.Api.Tests/{Domain/OrderTests.cs, Api/OrdersApiTests.cs,
Services/OrderServiceDuplicateTests.cs, Data/DataSeederTests.cs}`.
Frontend specs sit beside their component under `frontend/src/app/orders/`. E2E specs: `frontend/e2e/`.
