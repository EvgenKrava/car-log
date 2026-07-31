# Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An admin-only `/admin` dashboard showing user counts, API traffic, errors & latency, estimated AWS cost, and a recent-activity feed across all users.

**Architecture:** One admin-gated endpoint `GET /admin/metrics` aggregates Cognito (user counts), CloudWatch (`GetMetricData` for API Gateway v2 `Count`/`4xx`/`5xx`/`Latency` and `AWS/Billing EstimatedCharges`), and a bounded DynamoDB Scan (recent events across owners), behind the existing server-side admin guard. Frontend renders it as tiles + charts (dataviz).

**Tech stack:** AWS Lambda (TS), `@aws-sdk/client-cloudwatch`, existing Cognito adapter, CDK; React + MUI + TanStack Query + Zod; dataviz for charts; i18n en/uk.

## Global Constraints

- Strict TypeScript, never `any`; `type` aliases; `interface` only for ports.
- `packages/domain` must not import AWS SDK. Adapters/handlers thin.
- Zod in `packages/contracts` is source of truth; `z.infer` for types.
- Extensionless relative imports. No TODO/stub. No co-authorship trailer. Trailing newline.
- Every `/admin/*` route is gated by the existing server-side `isAdmin(groups)` guard (403 for non-admins) — reuse `admin-service`'s `requireAdmin` pattern.
- **CloudWatch metric names are HTTP API v2:** `AWS/ApiGateway` namespace, single `ApiId` dimension (value = `API_ID` env), metrics `Count`/`4xx`/`5xx`/`Latency`. NOT the REST v1 names `4XXError`/`5XXError`.
- AWS profile `yevhenii`, region `us-east-1`. Commit per task; push to `main` (no branch).

---

## File structure

**Backend**
- `packages/contracts/src/metrics.ts` (create) + `index.ts` (modify) — schemas.
- `apps/api/src/cloudwatch-metrics.ts` (create) — `MetricsPort` + `AwsCloudWatchMetrics` adapter.
- `packages/domain/src/event-repository.ts` (modify) — add `recentAcrossOwners`.
- `apps/api/src/dynamo-event-repository.ts` + `in-memory-event-repository.ts` (modify) — implement it.
- `apps/api/src/metrics-service.ts` (create) — `getMetrics(...)` aggregation.
- `apps/api/src/admin-routes.ts` (modify) — add `GET /admin/metrics`; `router.ts`/`handler.ts` wire the metrics port + `API_ID`.
- `infrastructure/cdk/lib/carlog-stack.ts` (modify) — `cloudwatch:GetMetricData` IAM, `API_ID` env, `/admin/metrics` route.

**Frontend**
- `apps/web/src/api-client.ts` + `queries.ts` (modify) — `getMetrics` + `useAdminMetrics`.
- `apps/web/src/components/ui/UserMenu.tsx` (modify) — "Dashboard" admin item.
- `apps/web/src/routes/admin/Dashboard.tsx` (create) + `main.tsx` (modify) — page + route.
- `apps/web/src/i18n/locales/{en,uk}/admin.json` (modify) — dashboard strings.

---

## Task 1: Metrics contracts

**Files:** create `packages/contracts/src/metrics.ts`, modify `index.ts`, test `packages/contracts/src/metrics.test.ts`.

**Produces:** `MetricsResponseSchema` + `MetricPointSchema`, `ActivityItemSchema`; types `MetricsResponse`, `MetricPoint`, `ActivityItem`.

- [ ] **Step 1: failing test** — `metrics.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { MetricsResponseSchema } from './metrics';

describe('metrics contracts', () => {
  const valid = {
    users: { total: 3, admins: 1, newLast30d: 2 },
    apiTraffic: [{ date: '2026-07-01', count: 120 }],
    errors: { count4xx: 4, count5xx: 1, p95LatencyMs: 210 },
    cost: { currency: 'USD', amount: 12.34, series: [{ date: '2026-07-01', amount: 1.2 }] },
    activity: [{ carId: 'c1', category: 'oil_change', date: '2026-07-01', cost: 100, currency: 'UAH', createdAt: '2026-07-01T10:00:00.000Z', ownerId: 'u1' }],
  };
  it('accepts a full payload', () => {
    expect(MetricsResponseSchema.parse(valid)).toMatchObject({ users: { total: 3 } });
  });
  it('rejects a bad point', () => {
    expect(() => MetricsResponseSchema.parse({ ...valid, apiTraffic: [{ date: 'x' }] })).toThrow();
  });
});
```

- [ ] **Step 2:** run → FAIL. `pnpm --filter @carlog/contracts test src/metrics.test.ts`

- [ ] **Step 3: implement** — `metrics.ts`

```ts
import { z } from 'zod';

export const MetricPointSchema = z.object({ date: z.string(), count: z.number() });
export const CostPointSchema = z.object({ date: z.string(), amount: z.number() });
export const ActivityItemSchema = z.object({
  carId: z.string(), category: z.string(), date: z.string(),
  cost: z.number(), currency: z.string(), createdAt: z.string(), ownerId: z.string(),
});
export const MetricsResponseSchema = z.object({
  users: z.object({ total: z.number(), admins: z.number(), newLast30d: z.number() }),
  apiTraffic: z.array(MetricPointSchema),
  errors: z.object({ count4xx: z.number(), count5xx: z.number(), p95LatencyMs: z.number() }),
  cost: z.object({ currency: z.string(), amount: z.number(), series: z.array(CostPointSchema) }),
  activity: z.array(ActivityItemSchema),
});
export type MetricPoint = z.infer<typeof MetricPointSchema>;
export type ActivityItem = z.infer<typeof ActivityItemSchema>;
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;
```

- [ ] **Step 4:** add `export * from './metrics';` to `index.ts`. Run test → PASS.
- [ ] **Step 5: commit** `feat(contracts): admin metrics schemas`

---

## Task 2: EventRepository.recentAcrossOwners

**Files:** modify `packages/domain/src/event-repository.ts`, `apps/api/src/dynamo-event-repository.ts`, `apps/api/src/in-memory-event-repository.ts`; test `apps/api/src/in-memory-event-repository.test.ts` (create if absent).

**Interfaces:**
- Produces on `EventRepository`: `recentAcrossOwners(limit: number): Promise<Event[]>` — newest by `createdAt` first, at most `limit`.

- [ ] **Step 1: add to the port** (`packages/domain/src/event-repository.ts`): add method signature `recentAcrossOwners(limit: number): Promise<Event[]>;` to the `EventRepository` interface.

- [ ] **Step 2: in-memory impl + test.** Read `in-memory-event-repository.ts` to see its store shape, then add:

```ts
async recentAcrossOwners(limit: number): Promise<Event[]> {
  return [...this.rows.values()]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}
```
(adapt `this.rows` to the actual field name). Test:

```ts
it('recentAcrossOwners returns newest-first, capped', async () => {
  const repo = new InMemoryEventRepository();
  await repo.create(mk('u1', 'c1', '2026-01-01T00:00:00.000Z'));
  await repo.create(mk('u2', 'c2', '2026-03-01T00:00:00.000Z'));
  await repo.create(mk('u1', 'c1', '2026-02-01T00:00:00.000Z'));
  const r = await repo.recentAcrossOwners(2);
  expect(r.map((e) => e.createdAt)).toEqual(['2026-03-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z']);
});
```
(write a local `mk(ownerId, carId, createdAt)` helper building a valid `Event`; look at an existing event test for the shape.)

- [ ] **Step 3: run test → PASS.** `pnpm --filter @carlog/api test src/in-memory-event-repository.test.ts`

- [ ] **Step 4: Dynamo impl (bounded Scan).** In `dynamo-event-repository.ts`, using the existing `isEventRow`/`toEvent` helpers:

```ts
async recentAcrossOwners(limit: number): Promise<Event[]> {
  // v1: bounded cross-owner Scan (documented trade-off — reads broadly, doesn't
  // scale; a GSI keyed by a constant PK + createdAt sort is the later fix). Cap the
  // pages scanned so cost stays bounded, filter to event rows, sort newest-first.
  const collected: Event[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  let pages = 0;
  do {
    const res = await this.client.send(new ScanCommand({
      TableName: this.tableName, ExclusiveStartKey, Limit: 200,
    }));
    for (const item of res.Items ?? []) {
      if (isEventRow(String((item as { SK?: string }).SK ?? ''))) collected.push(toEvent(item as never));
    }
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    pages += 1;
  } while (ExclusiveStartKey && pages < 10);
  return collected.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
}
```
Import `ScanCommand` from `@aws-sdk/lib-dynamodb` (match the existing import style in the file). Typecheck.

- [ ] **Step 5: run** `pnpm --filter @carlog/api test && pnpm --filter @carlog/api typecheck` → PASS (fix any other `EventRepository` fakes in api tests that now miss `recentAcrossOwners` — add a stub returning `[]`).
- [ ] **Step 6: commit** `feat(api): EventRepository.recentAcrossOwners (bounded scan)`

---

## Task 3: CloudWatch metrics port + adapter

**Files:** create `apps/api/src/cloudwatch-metrics.ts`. Add dep `@aws-sdk/client-cloudwatch` to `apps/api/package.json` (match sibling `@aws-sdk/*` version range), `pnpm install`.

**Interfaces:**
- `type ApiTrafficPoint = { date: string; count: number }`
- `interface MetricsPort { apiTraffic(apiId, start, end): Promise<ApiTrafficPoint[]>; errorTotals(apiId, start, end): Promise<{ count4xx: number; count5xx: number; p95LatencyMs: number }>; estimatedCost(start, end): Promise<{ currency: string; amount: number; series: { date: string; amount: number }[] }>; }`
- `class AwsCloudWatchMetrics implements MetricsPort` (ctor `(client: CloudWatchClient)`).

- [ ] **Step 1: add dep + install.** Run `pnpm install`.

- [ ] **Step 2: implement** `cloudwatch-metrics.ts`. Use one `GetMetricDataCommand` per method with `MetricDataQueries`. Dates are `Date` objects. Daily period = 86400.

```ts
import {
  CloudWatchClient, GetMetricDataCommand, type MetricDataQuery,
} from '@aws-sdk/client-cloudwatch';

export type ApiTrafficPoint = { date: string; count: number };

export interface MetricsPort {
  apiTraffic(apiId: string, start: Date, end: Date): Promise<ApiTrafficPoint[]>;
  errorTotals(apiId: string, start: Date, end: Date): Promise<{ count4xx: number; count5xx: number; p95LatencyMs: number }>;
  estimatedCost(start: Date, end: Date): Promise<{ currency: string; amount: number; series: { date: string; amount: number }[] }>;
}

const apiDim = (apiId: string) => [{ Name: 'ApiId', Value: apiId }];
const iso = (d: Date) => d.toISOString().slice(0, 10);

export class AwsCloudWatchMetrics implements MetricsPort {
  constructor(private readonly client: CloudWatchClient) {}

  private async get(queries: MetricDataQuery[], start: Date, end: Date) {
    const res = await this.client.send(new GetMetricDataCommand({
      StartTime: start, EndTime: end, MetricDataQueries: queries, ScanBy: 'TimestampAscending',
    }));
    return res.MetricDataResults ?? [];
  }

  async apiTraffic(apiId: string, start: Date, end: Date): Promise<ApiTrafficPoint[]> {
    const [r] = await this.get([{
      Id: 'count',
      MetricStat: { Metric: { Namespace: 'AWS/ApiGateway', MetricName: 'Count', Dimensions: apiDim(apiId) }, Period: 86400, Stat: 'Sum' },
    }], start, end);
    const ts = r?.Timestamps ?? []; const vs = r?.Values ?? [];
    return ts.map((t, i) => ({ date: iso(t), count: vs[i] ?? 0 }));
  }

  async errorTotals(apiId: string, start: Date, end: Date) {
    const results = await this.get([
      { Id: 'e4', MetricStat: { Metric: { Namespace: 'AWS/ApiGateway', MetricName: '4xx', Dimensions: apiDim(apiId) }, Period: 2592000, Stat: 'Sum' } },
      { Id: 'e5', MetricStat: { Metric: { Namespace: 'AWS/ApiGateway', MetricName: '5xx', Dimensions: apiDim(apiId) }, Period: 2592000, Stat: 'Sum' } },
      { Id: 'lat', MetricStat: { Metric: { Namespace: 'AWS/ApiGateway', MetricName: 'Latency', Dimensions: apiDim(apiId) }, Period: 2592000, Stat: 'p95' } },
    ], start, end);
    const sum = (id: string) => (results.find((x) => x.Id === id)?.Values ?? []).reduce((a, b) => a + b, 0);
    const p95 = (results.find((x) => x.Id === 'lat')?.Values ?? [])[0] ?? 0;
    return { count4xx: sum('e4'), count5xx: sum('e5'), p95LatencyMs: Math.round(p95) };
  }

  async estimatedCost(start: Date, end: Date) {
    const [r] = await this.get([{
      Id: 'cost',
      MetricStat: { Metric: { Namespace: 'AWS/Billing', MetricName: 'EstimatedCharges', Dimensions: [{ Name: 'Currency', Value: 'USD' }] }, Period: 86400, Stat: 'Maximum' },
    }], start, end);
    const ts = r?.Timestamps ?? []; const vs = r?.Values ?? [];
    const series = ts.map((t, i) => ({ date: iso(t), amount: vs[i] ?? 0 }));
    return { currency: 'USD', amount: series.length ? series[series.length - 1]!.amount : 0, series };
  }
}
```

- [ ] **Step 3:** `pnpm --filter @carlog/api typecheck` → PASS.
- [ ] **Step 4: commit** `feat(api): CloudWatch metrics port and adapter`

---

## Task 4: Metrics service

**Files:** create `apps/api/src/metrics-service.ts`, test `apps/api/src/metrics-service.test.ts`.

**Interfaces:**
- Consumes: `CognitoUserAdmin` (existing — has `listUsers`, `listGroupUsernames`), `MetricsPort`, `EventRepository`, `ADMIN_GROUP`, `AdminActor`, `requireAdmin`/`ForbiddenError` (from `admin-service`), `MetricsResponse` (contracts).
- Produces: `getMetrics(deps: { users: CognitoUserAdmin; metrics: MetricsPort; events: EventRepository; apiId: string; now: Date }, actor: AdminActor): Promise<MetricsResponse>`.

**Behavior:** `requireAdmin(actor)`; window = [now−30d, now]; users total by paginating `users.listUsers` (loop nextToken), admins = `listGroupUsernames(ADMIN_GROUP).size`, newLast30d = users with `createdAt` ≥ cutoff (the adapter's `CognitoUser.createdAt` is ISO); apiTraffic/errors/cost from `metrics`; activity = `events.recentAcrossOwners(20)` mapped to `ActivityItem`.

- [ ] **Step 1: failing test** — with fakes. Cover: non-admin → ForbiddenError; newLast30d cutoff (a user created 40d ago excluded, 10d ago included); activity mapped from events. (Write fakes for the three deps; `now` injected as a fixed `new Date('2026-07-31T00:00:00Z')`.)

```ts
import { describe, it, expect, vi } from 'vitest';
import { getMetrics } from './metrics-service';
import { ForbiddenError } from './admin-service';

const now = new Date('2026-07-31T00:00:00.000Z');
const users = (createDates: string[]) => ({
  listUsers: vi.fn(async () => ({ users: createDates.map((d, i) => ({ username: `u${i}`, sub: `s${i}`, email: `${i}@x.com`, status: 'CONFIRMED', enabled: true, createdAt: d })), nextToken: undefined })),
  listGroupUsernames: vi.fn(async () => new Set(['u0'])),
  getSub: vi.fn(async () => null), addToGroup: vi.fn(), removeFromGroup: vi.fn(), setEnabled: vi.fn(), deleteUser: vi.fn(),
});
const metrics = { apiTraffic: vi.fn(async () => []), errorTotals: vi.fn(async () => ({ count4xx: 0, count5xx: 0, p95LatencyMs: 0 })), estimatedCost: vi.fn(async () => ({ currency: 'USD', amount: 0, series: [] })) };
const events = { recentAcrossOwners: vi.fn(async () => []) } as never;

it('rejects non-admin', async () => {
  await expect(getMetrics({ users: users([]) as never, metrics, events, apiId: 'a', now }, { sub: 'x', isAdmin: false })).rejects.toBeInstanceOf(ForbiddenError);
});
it('counts newLast30d by cutoff', async () => {
  const res = await getMetrics({ users: users(['2026-07-21T00:00:00.000Z', '2026-06-01T00:00:00.000Z']) as never, metrics, events, apiId: 'a', now }, { sub: 'x', isAdmin: true });
  expect(res.users).toMatchObject({ total: 2, admins: 1, newLast30d: 1 });
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement** `metrics-service.ts`:

```ts
import type { MetricsResponse, ActivityItem } from '@carlog/contracts';
import { ADMIN_GROUP } from './admin-guard';
import { requireAdmin, type AdminActor } from './admin-service';
import type { CognitoUserAdmin } from './cognito-user-admin';
import type { MetricsPort } from './cloudwatch-metrics';
import type { EventRepository } from '@carlog/domain';

export async function getMetrics(
  deps: { users: CognitoUserAdmin; metrics: MetricsPort; events: EventRepository; apiId: string; now: Date },
  actor: AdminActor,
): Promise<MetricsResponse> {
  requireAdmin(actor);
  const { users, metrics, events, apiId, now } = deps;
  const start = new Date(now.getTime() - 30 * 86_400_000);
  const cutoff = start.toISOString();

  // Count all users (paginate).
  const all: { createdAt: string }[] = [];
  let token: string | undefined;
  do {
    const page = await users.listUsers(token);
    all.push(...page.users);
    token = page.nextToken;
  } while (token);
  const adminUsernames = await users.listGroupUsernames(ADMIN_GROUP);

  const [apiTraffic, errors, cost, recent] = await Promise.all([
    metrics.apiTraffic(apiId, start, now),
    metrics.errorTotals(apiId, start, now),
    metrics.estimatedCost(start, now),
    events.recentAcrossOwners(20),
  ]);

  const activity: ActivityItem[] = recent.map((e) => ({
    carId: e.carId, category: e.category, date: e.date, cost: e.cost,
    currency: e.currency, createdAt: e.createdAt, ownerId: e.ownerId,
  }));

  return {
    users: { total: all.length, admins: adminUsernames.size, newLast30d: all.filter((u) => u.createdAt >= cutoff).length },
    apiTraffic, errors, cost, activity,
  };
}
```
(`requireAdmin` must be exported from `admin-service.ts` — it currently is a private function; export it. Small change to that file.)

- [ ] **Step 4:** run test → PASS. `pnpm --filter @carlog/api test src/metrics-service.test.ts`
- [ ] **Step 5: commit** `feat(api): admin metrics aggregation service`

---

## Task 5: /admin/metrics route + wiring

**Files:** modify `apps/api/src/admin-routes.ts` (add the route + accept the new deps), `router.ts` (RouteDeps: add `metrics: MetricsPort`, `events` already present, `apiId: string`), `handler.ts` (construct `AwsCloudWatchMetrics`, pass `process.env.API_ID ?? ''`). Test: extend `admin-routes.test.ts`.

- [ ] **Step 1:** `handleAdminRoute` signature currently `(port, event)`. Add the metrics dependencies. Change it to accept a deps object: `handleAdminRoute(deps: { users: CognitoUserAdmin; metrics: MetricsPort; events: EventRepository; apiId: string }, event)`. Update `router.ts`'s call site and `RouteDeps` accordingly (it already has `events`; add `metrics`, `apiId`). In `handler.ts` construct `new AwsCloudWatchMetrics(new CloudWatchClient({}))` and set `apiId: process.env.API_ID ?? ''`.

- [ ] **Step 2:** in `handleAdminRoute`, add before the 404 fallback:

```ts
if (path === '/admin/metrics' && method === 'GET') {
  return ok(200, await getMetrics(
    { users: deps.users, metrics: deps.metrics, events: deps.events, apiId: deps.apiId, now: new Date() },
    actor,
  ));
}
```
(`actor` is already built from `isAdmin(groups)`; `getMetrics` calls `requireAdmin`, so non-admins → 403 via the existing catch.)

- [ ] **Step 3:** add a test to `admin-routes.test.ts`: admin GET `/admin/metrics` → 200 with a `users` object (fake metrics port returns empty arrays); non-admin → 403. Update the existing fakes/deps to the new object-shaped signature.

- [ ] **Step 4:** `pnpm --filter @carlog/api test && typecheck` → PASS (fix `router.test.ts` deps: add `metrics` fake + `apiId`).
- [ ] **Step 5: commit** `feat(api): GET /admin/metrics route`

---

## Task 6: CDK — CloudWatch IAM, API_ID env, route

**Files:** modify `infrastructure/cdk/lib/carlog-stack.ts`.

- [ ] **Step 1:** add to the Lambda `environment`: `API_ID: httpApi.apiId,`.
- [ ] **Step 2:** grant CloudWatch read — a new statement (GetMetricData has no resource-level scoping):
```ts
fn.addToRolePolicy(new PolicyStatement({ actions: ['cloudwatch:GetMetricData'], resources: ['*'] }));
```
- [ ] **Step 3:** add the route: `httpApi.addRoutes({ path: '/admin/metrics', methods: [HttpMethod.GET], integration, authorizer });`
- [ ] **Step 4:** `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk synth` succeeds; template shows `API_ID`, the cloudwatch policy, and the route. Commit `feat(cdk): CloudWatch IAM, API_ID env, /admin/metrics route`.

---

## Task 7: Frontend api-client + hook

**Files:** modify `apps/web/src/api-client.ts`, `queries.ts`.

- [ ] **Step 1:** `getMetrics(token): Promise<MetricsResponse>` → `request(token, '/admin/metrics', MetricsResponseSchema)` (import `MetricsResponseSchema` from `@carlog/contracts`; mirror `listUsers`).
- [ ] **Step 2:** `useAdminMetrics()` (mirror `useAdminUsers`) with `queryKey: ['admin','metrics']`, `staleTime: 5 * 60_000` to limit CloudWatch calls.
- [ ] **Step 3:** `pnpm --filter @carlog/web typecheck && lint` → PASS. Commit `feat(web): admin metrics client + hook`.

---

## Task 8: Dashboard page + nav + route

**Files:** create `apps/web/src/routes/admin/Dashboard.tsx`, modify `main.tsx`, `UserMenu.tsx`.

**Invoke the dataviz skill before writing the charts.** Single accent hue for the API-traffic area/line chart; reserved status colors (error/warning) for 4xx/5xx, each with an icon+label (never color-alone); validate light + dark.

- [ ] **Step 1:** `UserMenu.tsx` — add a "Dashboard" `MenuItem` (admin-only, above "User management") navigating to `/admin`, icon `DashboardIcon`, label `t('admin:dashboard')`.
- [ ] **Step 2:** `main.tsx` — `<Route path="/admin" element={<RequireAdmin><Dashboard /></RequireAdmin>} />` (import `Dashboard`).
- [ ] **Step 3:** `Dashboard.tsx` — `AppShell` + `PageHeader title={t('admin:dashboardTitle')} onBack`. Uses `useAdminMetrics()`. Loading/error via `StatusView`. Layout:
  - Stat tiles row (reuse the vehicle-hero tile pattern or simple Cards): Total users, Admins, New (30d), `cost.amount` + `cost.currency`.
  - API-traffic chart: a small inline SVG/`<Box>` area or bar chart over `apiTraffic` (mirror `SpendSparkline`'s approach for a dependency-free chart), accent hue, hover tooltip.
  - Errors & latency: two `Chip`s (`color="error"` 4xx count with icon, `color="warning"` 5xx) + a "p95 {{ms}} ms" line.
  - Recent activity: list of `activity` rows — category chip via `CATEGORY_META`, `formatDate(createdAt)`, cost, truncated `ownerId`.
- [ ] **Step 4:** `pnpm --filter @carlog/web typecheck && build && lint` → PASS. Commit `feat(web): admin dashboard page`.

---

## Task 9: i18n

**Files:** modify `apps/web/src/i18n/locales/{en,uk}/admin.json`.

- [ ] **Step 1:** add keys (en): `dashboard`: "Dashboard", `dashboardTitle`: "Dashboard", `metricUsers`: "Users", `metricAdmins`: "Admins", `metricNew30d`: "New (30d)", `metricCost`: "Est. cost", `apiTraffic`: "API traffic (30d)", `errors4xx`: "4xx", `errors5xx`: "5xx", `p95Latency`: "p95 latency", `recentActivity`: "Recent activity", `loadError`: reuse existing, `empty`: reuse. uk equivalents (translate). Keep symmetric.
- [ ] **Step 2:** `pnpm --filter @carlog/web typecheck && build` → PASS. Commit `feat(web): en/uk strings for admin dashboard`.

---

## Task 10: Deploy + verify

- [ ] **Step 1:** `pnpm turbo run build lint typecheck test` → all green.
- [ ] **Step 2:** CDK deploy, then `./scripts/deploy-web.sh` (AWS_PROFILE=yevhenii).
- [ ] **Step 3:** verify: as admin, `/admin` renders tiles + charts + activity; `GET <ApiUrl>/admin/metrics` unauth → 401, non-admin → 403. Confirm CloudWatch data appears (traffic may be sparse — that's fine). New web bundle hash live; invalidation completed.

---

## Self-review

- **Coverage:** users→T4; apiTraffic/errors/cost→T3+T4; activity→T2+T4; endpoint+guard→T5; IAM/env/route→T6; contracts→T1; frontend hook→T7; page+nav+charts→T8; i18n→T9; deploy→T10. All covered.
- **Metric names:** HTTP API v2 (`Count`/`4xx`/`5xx`/`Latency`, `ApiId` dim) used in T3 per Global Constraints.
- **Types:** `MetricsResponse`/`ActivityItem`/`MetricPoint` consistent across T1 (contracts), T3/T4 (service), T7/T8 (frontend). `requireAdmin` exported from admin-service in T4. `recentAcrossOwners` signature consistent T2↔T4.