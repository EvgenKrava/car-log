# Admin Dashboard — Design

**Date:** 2026-07-31
**Status:** Approved (design greenlit)

## Goal

An admin-only dashboard at `/admin` showing operational metrics: user counts, API
traffic, errors & latency, estimated AWS cost, and a recent-activity feed across all
users. Builds on the existing admin feature (Cognito `admin` group + server-side
admin guard). Mobile-first.

## Nav & routing

- New page **`/admin`** behind the existing `RequireAdmin` guard.
- `UserMenu`'s admin section gets a **"Dashboard"** item (placed above "User
  management"). Both items are admin-only, both behind `RequireAdmin`.

## Backend

One admin-gated endpoint, `GET /admin/metrics`, behind the existing server-side admin
guard (`isAdmin(groups)` from the token — 403 for non-admins). Returns a single
aggregated payload so the frontend makes one request. All AWS reads happen server-side.

### Payload (`MetricsResponse`)
- `users`: `{ total: number, admins: number, newLast30d: number }`
  - `total`: paginate Cognito `ListUsers`, count.
  - `admins`: size of `ListUsersInGroup('admin')`.
  - `newLast30d`: count of users whose `UserCreateDate` ≥ now−30d.
- `apiTraffic`: `Array<{ date: string; count: number }>` — 30 daily points of the
  request `Count` metric (CloudWatch `GetMetricData`, `AWS/ApiGateway` namespace,
  period 86400, SUM).
- `errors`: `{ count4xx: number; count5xx: number; p95LatencyMs: number }` — 30-day
  totals of `4xx`/`5xx` (SUM) and `Latency` p95 (extended stat `p95`, avg over window).

> **CloudWatch metric names — this is an HTTP API (API Gateway v2), NOT a REST API.**
> Use the v2 metric names in the `AWS/ApiGateway` namespace with a single `ApiId`
> dimension (value = `API_ID` env): `Count`, `4xx`, `5xx`, `Latency`. Do **not** use
> the REST-API v1 names (`4XXError`/`5XXError`) or the `ApiName`/`Stage` dimensions —
> they return empty for an HTTP API.
- `cost`: `{ currency: string; amount: number; series: Array<{ date: string; amount: number }> }`
  — `AWS/Billing` `EstimatedCharges` metric (us-east-1 only, `Currency=USD`), MAX per
  day over the current month; `amount` = latest point (current running estimate).
- `activity`: `Array<{ carId: string; category: string; date: string; cost: number; currency: string; createdAt: string; ownerId: string }>`
  — latest ~20 service records across ALL users, newest by `createdAt`.

### Layering (per AGENTS.md)
- `packages/domain` stays SDK-free.
- New `MetricsPort` interface + CloudWatch adapter (`@aws-sdk/client-cloudwatch`) in
  `apps/api`. Reuse the existing Cognito adapter for user counts.
- Recent activity: a new `EventRepository.recentAcrossOwners(limit)` method. Dynamo
  implementation uses a **bounded `Scan`** (documented v1 trade-off: reads broadly,
  doesn't scale — a GSI keyed by a constant PK + `createdAt` sort is the later fix)
  that filters event items, sorts by `createdAt` desc in memory, returns the top N.
  Bound the scan (e.g. `Limit` + a max page count) so cost is capped.
- A thin application service `getMetrics(...)` composes the three sources; the handler
  parses input, calls it, shapes the response.

### CDK
- Grant the Lambda role `cloudwatch:GetMetricData` (resource `*` — CloudWatch
  GetMetricData does not support resource-level scoping). DynamoDB `Scan` is already
  covered by the existing `grantReadWriteData`.
- Add the `GET /admin/metrics` route (JWT authorizer, shared integration).
- Pass the API Gateway `ApiId` to the Lambda as an env var (`API_ID`) so the
  CloudWatch dimension can be set. (Available in the stack as `httpApi.apiId`.)

### Contracts (`packages/contracts`, Zod → `z.infer`)
- `MetricsResponseSchema` with the nested shapes above; `MetricPointSchema`,
  `ActivityItemSchema`.

## Frontend

- `useAdminMetrics()` — one TanStack query hitting `GET /admin/metrics`, with a
  `staleTime` (e.g. 5 min) to limit CloudWatch calls.
- New route `/admin` → `Dashboard` page (behind `RequireAdmin`), using `AppShell` +
  `PageHeader`.
- **Layout (mobile-first):**
  - A row/grid of stat tiles: Total users, Admins, New (30d), Est. cost (USD).
  - **API traffic** area/line chart (30 daily points) — single accent hue, per the
    dataviz approach (hover tooltip, direct axis labels, no legend for one series).
  - **Errors & latency** mini-panel: 4xx / 5xx counts (status colors, with
    icon+label, never color-alone) + p95 latency value.
  - **Recent activity** list: each row = category chip (reuse `CATEGORY_META`), date,
    cost, and a truncated owner id.
  - Loading / error / empty states via `StatusView` / `EmptyState`.
- **Charts:** invoke the dataviz skill before building; single accent hue for traffic;
  reserved status colors for errors; validated in light + dark.
- `UserMenu`: add the "Dashboard" admin item.
- Full en/uk i18n (`admin` namespace additions or a new `dashboard` namespace).

## Testing

- Contracts: schema parse/reject tests.
- Metrics service: unit tests with fake ports (users mapping, newLast30d cutoff,
  activity sort/limit).
- `recentAcrossOwners`: in-memory repo test (sort desc, limit).
- Guard reused (already tested).
- Live verification of the endpoint (200 as admin, 403 non-admin) + the page after deploy.

## Out of scope (later)

- Per-service cost breakdown / Cost Explorer (we use the free CloudWatch estimate).
- A GSI for scalable cross-user activity (bounded Scan for v1).
- Selectable time ranges (fixed 30 days).
- Real-time / auto-refresh (client staleTime only).