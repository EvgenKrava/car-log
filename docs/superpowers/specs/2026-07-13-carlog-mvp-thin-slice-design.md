# CarLog MVP — Deployable Thin Slice Design

**Date:** 2026-07-13
**Status:** Approved (brainstorming) → ready for implementation plan

## Goal

Prove the entire CarLog stack end-to-end by scaffolding the full monorepo and
implementing **one vertical**: a user logs in, sees their garage, and adds a
car. Everything is wired to real AWS and deployed to `us-east-1` using the
`yevhenii` CLI profile. Depth is deliberately narrow (one entity, one write
path) so we validate architecture and deployment before building wide.

This is Phase 1 of `carlog-docs/ROADMAP.md`, reduced to a single vertical.

## Locked Decisions

| Area | Decision |
|------|----------|
| Build scope | Deployable thin slice: full monorepo scaffold + one vertical (login → garage → add car) |
| Auth | Real Cognito User Pool + **Hosted UI**; API Gateway validates JWT via native Cognito authorizer |
| Data model | **Single-table DynamoDB**; key encoding hidden inside the repository |
| Deploy | **Actually deploy** to AWS `us-east-1` with `--profile yevhenii`, verify against live resources |
| Web hosting | **S3 + CloudFront** |
| API type | API Gateway **HTTP API (v2)** with native Cognito JWT authorizer |
| Car fields | Fuller: make, model, year, mileage, nickname, VIN, license plate, fuel type |
| Build strategy | Approach A — contracts-first, sequential, single deploy at the end |

## Monorepo Structure & Tooling

```
carlog/
  package.json            # root, pnpm workspaces + turbo
  pnpm-workspace.yaml
  turbo.json
  tsconfig.base.json      # strict TS, shared compiler options
  .eslintrc / .prettierrc
  apps/
    web/                  # Vite + React + TS + MUI
    api/                  # Lambda handlers (esbuild-bundled by CDK)
  packages/
    contracts/            # Zod schemas + z.infer types (source of truth)
    domain/               # Car entity + business rules — zero AWS/framework deps
    config/               # shared tsconfig/eslint presets, env constants
  infrastructure/
    cdk/                  # single CDK app, one stack for the slice
```

- **pnpm workspaces + Turborepo**; internal packages referenced via `workspace:*`.
- **TypeScript strict**, `moduleResolution: "bundler"` → **extensionless relative imports**
  (Vite + esbuild both resolve it).
- **Deferred (YAGNI for the slice):** `packages/api-client` and `packages/utils` from
  `ARCHITECTURE.md`. The web app calls the API through a small typed fetch wrapper
  built directly from `contracts` types. Add these packages when a feature needs them.
- CDK bundles the Lambda with `NodejsFunction` (esbuild); `apps/api` has no separate build step.

## Contracts & Domain Model

### `packages/contracts` (Zod = single source of truth, types via `z.infer`)

```ts
FuelType = 'petrol' | 'diesel' | 'electric' | 'hybrid' | 'lpg' | 'other'

CarSchema = {
  id, ownerId, make, model, year, mileage,
  nickname?, vin?, licensePlate?, fuelType, createdAt, updatedAt
}
CreateCarSchema = CarSchema.omit({ id, ownerId, createdAt, updatedAt })
UpdateCarSchema = CreateCarSchema.partial()
```

- `year`: int in `1900..currentYear+1`. `mileage`: non-negative int.
- `vin`: optional, length/charset validated. Empty optional strings normalized to `undefined`.
- Imported by **both** API (request validation + response typing) and web
  (RHF `zodResolver` + response typing).

### `packages/domain` (framework-independent, no AWS SDK)

- `Car` type (re-exported from contracts) + pure factory `createCar(ownerId, input): Car`
  that assigns id/timestamps and enforces invariants.
- **`CarRepository` interface** (port): `create`, `listByOwner`, `getById`, `update`, `delete`.
  The DynamoDB implementation lives in `apps/api`, not here — domain depends only on the interface.
- Id generation via `crypto.randomUUID()`, wrapped so domain stays deterministic under test.

**Completeness rule (per `AGENTS.md`: no TODO implementations):** all five repository
methods and all four `/cars` routes are fully implemented. The **UI** only exercises
create + list; the other routes are complete backend code, simply not surfaced in the
slice's screens.

## Backend — Lambda + DynamoDB Single-Table

### Table `CarLogTable` (on-demand billing)

Key encoding is hidden entirely inside the repository:

```
PK                SK              entity   attributes
USER#<sub>        CAR#<carId>     Car      make, model, year, mileage, vin, ...
```

Access patterns (slice):
- **list cars for user** → `Query PK = USER#<sub> AND begins_with(SK, "CAR#")`
- **get one car** → `GetItem PK=USER#<sub>, SK=CAR#<id>`
- **create / update / delete** → Put/Update/Delete on that key

No GSI needed (ownership is the partition key). Documented future note: Events land as
`PK=CAR#<id>, SK=EVENT#<ts>` with a GSI — **not created now** (unused resource).

### Lambda / API layer (`apps/api`)

- **One `NodejsFunction`** fronts all `/cars` routes, routing internally by method+path.
- **Thin handler flow:** read `ownerId` from JWT claims
  (`event.requestContext.authorizer.jwt.claims.sub`, populated by the API Gateway
  Cognito authorizer — the Lambda never verifies tokens itself) → validate body with the
  contracts Zod schema → call domain/repository → map result to HTTP response.
- **DynamoDB access** via `@aws-sdk/lib-dynamodb` `DocumentClient`, isolated in
  `DynamoCarRepository implements CarRepository` — the only place the AWS SDK appears on the write path.
- **Error handling:** `withErrorHandling` wrapper — Zod error → 400 (field details),
  `NotFound` domain error → 404, unexpected → 500 (logged, generic client message).
  CORS headers on every response for the CloudFront origin.

Routes (all real): `GET /cars`, `POST /cars`, `PUT /cars/{id}`, `DELETE /cars/{id}`.
Out of scope for the slice: `/cars/{id}/events`, `/attachments/presign`.

## Frontend — login → garage → add car

**Wiring** (`apps/web`): Vite + React + TS, MUI theme (light/dark via `useMediaQuery` +
`ThemeProvider`), TanStack Query for server state, React Hook Form + `zodResolver` using
the **contracts** schemas, React Router.

**Auth (Cognito Hosted UI):**
- Config (User Pool domain, client id, redirect URIs) injected at build time via Vite env
  vars sourced from **CDK stack outputs**.
- `AuthProvider` runs the OAuth **authorization-code + PKCE** flow via `react-oidc-context`
  (wrapper over `oidc-client-ts`) pointed at the Cognito issuer; stores tokens, exposes
  `user`/`signinRedirect`/`signoutRedirect`, silently refreshes.
- `RequireAuth` guard redirects unauthenticated users to Hosted UI; `/callback` route
  completes the code exchange.
- The API fetch wrapper attaches `Authorization: Bearer <token>` from the auth context.

**Screens (slice subset of `UI_UX.md`):**
- `/callback` — completes OAuth, redirects to garage.
- **Garage (`/`)** — landing after login. `useCars()` → grid of **MUI Cards** (nickname or
  make+model, year, mileage). Empty state prompts "Add your first car." A **FAB** opens Add Car.
- **Add Car** — MUI Dialog (full-screen on mobile), RHF form validated by `CreateCarSchema`;
  submit → `useCreateCar()` → invalidates `['cars']` → closes. Fields: make, model, year,
  mileage, nickname, VIN, license plate, fuelType (select).

**API layer:** tiny typed `apiClient` (fetch + base URL from env + auth header + Zod-parse
of responses). Query key `['cars']`; mutations invalidate it.

Out of scope: Vehicle detail, timeline, events, reminders screens.

## Testing

Per `CONTRIBUTING.md` (unit tests for business logic):
- **`packages/domain`** — Vitest unit tests on `createCar`: valid car, mileage/year bounds,
  optional-field normalization. Primary coverage.
- **`apps/api`** — handler tests using an **in-memory `CarRepository`** fake: routing,
  Zod 400s, 404, ownerId-from-claims wiring. No AWS.
- **`packages/contracts`** — schema round-trip tests (accept valid, reject invalid).
- **Frontend / CDK** — no unit tests in the slice; verified by the live smoke test.
  Static gates: `cdk synth`, `tsc --noEmit`, `eslint`.

**Turbo pipeline:** `build`, `lint`, `typecheck`, `test` in `turbo.json` with `dependsOn`
wiring so `pnpm turbo run <task>` works repo-wide.

## Deployment (one CDK stack, `us-east-1`, `--profile yevhenii`)

1. `pnpm install` → `pnpm turbo run build lint typecheck test` (all green before deploy).
2. `cdk deploy` provisions: Cognito User Pool + Hosted UI domain + app client, DynamoDB
   table, HTTP API + Cognito JWT authorizer + Lambda, S3 bucket + CloudFront distribution.
   **Outputs:** API URL, User Pool id, client id, Cognito domain, CloudFront URL.
3. Feed outputs into the web build env → `vite build` → sync `dist/` to S3 → CloudFront
   invalidation. Cognito callback/logout URLs point at the CloudFront domain. Effectively
   two passes (infra, then web with real outputs), scripted to one command each.

`cdk destroy` documented for teardown.

## Definition of Done (live verification)

Open the CloudFront URL → redirected to Cognito Hosted UI → sign up / confirm a test user →
land on empty Garage → add a car via FAB → card appears → reload → car persists. This proves
the Dynamo write + authorized read end-to-end against real AWS.

## Notes / Caveats

- Deploying real Cognito + CloudFront + API creates **billable resources**; CloudFront
  distributions take ~5–10 min to deploy/tear down.
- `packages/api-client`, `packages/utils`, Events, Attachments, Reminders, and all other
  Phase 1+ screens are intentionally out of scope for this slice.