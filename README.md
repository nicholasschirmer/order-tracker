# Order Tracker

A small internal web app for a sales team to record customer purchase orders and track their
status. Resubmitting an order with the same client reference never creates a duplicate.

* **Frontend:** Angular 22
* **Backend:** ASP.NET Core 10 Minimal API (C#)
* **Database:** SQLite (EF Core)
* **Method:** test-driven development throughout; Playwright end-to-end tests with screenshots

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/architecture.md](docs/architecture.md) | Component diagram, request flow, idempotency design, status state machine |
| [docs/solution-outline.md](docs/solution-outline.md) | Goals, domain model, API surface, screens, project layout |
| [docs/scenarios.md](docs/scenarios.md) | Numbered Given/When/Then scenarios (S01–S21) and traceability matrix |

## Prerequisites

* .NET SDK 10.x
* Node.js 22.22+, 24.15+ or 26+ (Angular 22 requirement) and npm

## Quick start: `./dev.sh`

`dev.sh` runs both servers and gives you a small CLI to see what is running and read errors.
It picks a Node version Angular supports automatically (see the note in the Frontend section).

```bash
./dev.sh                  # start backend + frontend, stream both logs (colour-tagged), Ctrl+C stops both
./dev.sh start [svc]      # start in the background          svc = backend | frontend (default both)
./dev.sh stop  [svc]      # stop (kills the whole process tree, never leaves orphans on :5080/:4200)
./dev.sh restart [svc]
./dev.sh status           # running/stopped, pid, health check, order count in the dev db, error count
./dev.sh logs [svc] [-f]  # last 60 lines, or follow; error lines red, warnings yellow
./dev.sh errors [svc]     # only error/warning/exception lines with their stack traces
./dev.sh test [backend|frontend|e2e|all]
./dev.sh seed [N]         # add N realistic demo orders (default 200) — see "Demo data"
./dev.sh clean            # remove logs, pid files and the dev SQLite database
```

Logs and pid files live in `.dev/` (git-ignored). Ports can be overridden with `BACKEND_PORT` and
`FRONTEND_PORT`.

## Backend

```bash
cd backend
dotnet test          # 92 tests: domain rules, HTTP scenarios S01–S23, duplicate-prevention unit tests, data seeder
dotnet run --project src/OrderTracker.Api   # http://localhost:5080, creates orders.db on first run
```

Quick smoke test:

```bash
curl -s -X POST localhost:5080/api/orders -H 'content-type: application/json' \
  -d '{"clientReference":"PO-100","customerName":"Acme Ltd","lines":[{"product":"Widget","quantity":10,"unitPrice":2.5}]}'
# run it again: same body → 200 + X-Idempotent-Replay: true, no second order
curl -s localhost:5080/api/orders
```

| Method | Route | Notes |
|--------|-------|-------|
| POST | `/api/orders` | 201 new · 200 idempotent replay · 400 validation · 409 same reference, different details |
| GET | `/api/orders?status=&search=` | newest first |
| GET | `/api/orders/{id}` | 404 if unknown |
| PATCH | `/api/orders/{id}/status` | `{"status":"Approved"}` · 422 illegal transition. Workflow: Submitted → Approved → Shipped → Delivered; Cancelled from Submitted/Approved; LostInTransit from Shipped |
| GET | `/health` | `Healthy` |

Backend layout: `Domain/` (Order aggregate, state machine, status history), `Data/` (EF Core SQLite
context with a unique index on the normalised reference, demo data seeder), `Services/` (idempotent
create, validation), `Endpoints/` (Minimal API).

Duplicate prevention is tested at three levels: `Domain/OrderTests` (payload equality, reference
normalisation), `Services/OrderServiceDuplicateTests` (replay / conflict outcomes, the unique index,
and the lookup→insert race reproduced deterministically with an EF Core `SaveChangesInterceptor`
that lets a competitor commit first), and `Api/OrdersApiTests` S02–S05 over HTTP including 10
parallel submissions.

The schema is created with `EnsureCreated()` and never migrated, so after a schema change run
`./dev.sh clean` (deletes the dev database) and reseed. Tests live in `backend/tests/OrderTracker.Api.Tests` and are named after the scenario
they prove (e.g. `S02_Resubmitting_identical_order_returns_200_replay_of_original`).

### Demo data

```bash
./dev.sh seed 500                 # or: cd backend/src/OrderTracker.Api && dotnet run -- --seed 500
```

`DataSeeder` (in `Data/`) generates orders through the real domain model: 28 customers, a
30-item catalogue with ±10 % negotiated prices, 1–5 lines per order, statuses reached through
legal transitions (roughly 22 % Submitted, 18 % Approved, 15 % Shipped, 35 % Delivered,
10 % Cancelled) and creation times spread over the last 90 days. References are
`PO-<year>-0001…`; re-running skips references that already exist, and the output is
deterministic for a given random seed. It has its own tests in `tests/.../Data/DataSeederTests.cs`.
Screenshots of the UI with 500 seeded orders are in [docs/screenshots/](docs/screenshots/).

> Arch Linux note: the distro `dotnet-sdk` package lacks ASP.NET Core prune data, so
> `backend/Directory.Build.props` sets `AllowMissingPrunePackageData=true`.

## Frontend

Angular 22 (standalone components, signals, zoneless) with Vitest unit tests and Playwright e2e.
The Angular CLI requires Node 22.22+/24.15+/26+; if your default `node` is another version, prefix
commands with the right one (e.g. `PATH=/usr/bin:$PATH`).

```bash
cd frontend
npm install
npm run test:ci      # 44 Vitest specs: OrderService + OrderList + NewOrder + OrderDetail (incl. timeline) + badge + routes
npm start            # http://localhost:4200, proxies /api → http://localhost:5080 (start the backend first)
```

Screens:

| Route | Screen |
|-------|--------|
| `/orders` | List with status filter, search, status badges, empty state; stacks into cards on phones |
| `/orders/new` | Order form with dynamic line items, inline validation, running total. A resubmission with the same details redirects to the existing order with an "already submitted" notice; the same reference with different details shows a conflict banner linking to the existing order |
| `/orders/:id` | Order detail with lines, total, a status timeline (every status reached with its time, current highlighted, remaining steps pending) and a button for each transition the backend allows |

Frontend layout: `src/app/orders/order.service.ts` (typed API client; 409 is surfaced as a
`conflict` outcome rather than an exception), `order-list/`, `new-order/`, `order-detail/`,
`shared/status-badge.ts`. Every component has a `*.spec.ts` beside it.

## End-to-end tests (Playwright)

```bash
cd frontend
npx playwright install chromium   # first time only
npm run e2e                       # boots the API on :5080 with a fresh SQLite db + ng serve on :4200
npm run e2e:report                # open the HTML report
```

20 tests in `frontend/e2e/` drive the real stack through a headless Chromium browser and cover
S01–S03, S06, S09–S15, S17, S20, S22, S23 and the layout scenario S21. They run in one worker, in file order,
so `01-empty-state.spec.ts` always sees an empty database.

Screenshots are written to `frontend/e2e/screenshots/` on every run and are the formatting review
artefact:

| File | What it shows |
|------|---------------|
| `01-orders-empty-{desktop,mobile}.png` | Empty list with call to action |
| `02-new-order-filled.png` | Completed form with running total |
| `03-order-detail-created.png` | Detail page after a successful submission (green notice) |
| `04-order-detail-replayed.png` | Same order resubmitted — blue "already submitted, no duplicate" notice |
| `05-new-order-conflict.png` | Same reference, different details — red banner with link to existing order |
| `06-new-order-validation.png` | Inline validation errors, submit disabled |
| `07-orders-list.png`, `08-orders-list-filtered.png` | List, newest first; filtered to Approved |
| `09`–`13-order-detail-*.png` | Approved, Delivered, Cancelled, Shipped (with "Mark lost in transit") and Lost in transit states |
| `layout-{list,new-order-errors,detail}-{desktop,mobile}.png` | S21 layout checks at 1280×800 and 390×844 |

The layout spec also asserts that no page scrolls sideways, that every list row (including the
total) fits inside the viewport, and that the header navigation stays on one line.

## Docker

Both apps have multi-stage Dockerfiles; `docker-compose.yml` wires them together.

```bash
docker compose up -d --build          # web on http://localhost:8080, API reachable only via nginx
docker compose run --rm backend --seed 200   # optional: demo data into the shared volume
docker compose logs -f                # follow both containers
docker compose down                   # stop (add -v to also delete the orders database)
```

| Image | Base | Contents |
|-------|------|----------|
| `order-tracker-api` ([backend/Dockerfile](backend/Dockerfile)) | `mcr.microsoft.com/dotnet/aspnet:10.0` | Published API on port 8080, runs as the non-root `app` user, SQLite at `/data/orders.db` on the `orders-data` volume, `/health` health check |
| `order-tracker-web` ([frontend/Dockerfile](frontend/Dockerfile)) | `nginx:1.27-alpine` | Production Angular build. nginx serves the SPA (deep links fall back to `index.html`, hashed bundles cached immutably) and proxies `/api` and `/health` to `API_URL` (default `http://backend:8080`) |

Build an image on its own with `docker build -t order-tracker-api ./backend` or
`docker build -t order-tracker-web ./frontend`. Any arguments passed to the API container go to
the app, so `docker run --rm -v orders:/data order-tracker-api --seed 100` seeds a volume.
Because the browser only ever talks to nginx, no CORS configuration is needed in containers.

## Running everything

```bash
(cd backend && dotnet test) && (cd frontend && npm run test:ci && npm run e2e)
```

## Status

- [x] Phase 1 — Design docs
- [x] Phase 2 — Backend (TDD) — 92 tests green
- [x] Phase 3 — Frontend (TDD) — 44 tests green
- [x] Phase 4 — Playwright e2e + screenshots — 20 tests green, screenshots reviewed at desktop and mobile widths
