# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

CarLog is **pre-code**. The repository currently contains only planning docs under `carlog-docs/` and IntelliJ project files — there is no `package.json`, no `apps/`, and no `packages/` yet. The specification below is the intended design; when scaffolding, treat `carlog-docs/` as the source of truth and keep it in sync as decisions evolve.

Read the relevant `carlog-docs/*.md` before implementing a feature — the docs are terse and authoritative:
- `ARCHITECTURE.md` — repo layout, request flow, principles
- `DOMAIN.md` — the domain model (Garage → Car → Event → Work → PartUsage, plus Reminder)
- `API.md` — the REST surface
- `AGENTS.md` — hard coding rules (see below)
- `DECISIONS.md` — ADRs behind the stack choices
- `ROADMAP.md` — phasing; MVP is Phase 1 only
- `UI_UX.md` — screen list and UI conventions

## What CarLog is

A web-first digital service book: vehicle owners keep the full maintenance history of every car they own in one searchable timeline, replacing notebooks, paper invoices, and scattered photos. The **timeline is the primary screen**; the MVP (Phase 1) is auth + garage + vehicles + timeline + events + attachments.

## Tech stack

- **Monorepo:** pnpm + Turborepo
- **Frontend:** React + TypeScript + Material UI, TanStack Query, React Hook Form, Zod
- **Backend:** AWS Lambda (TypeScript) behind API Gateway, DynamoDB, S3 (pre-signed uploads), Cognito auth
- **Infra:** AWS CDK

## Intended repository layout

```
apps/web/            React frontend (feature-oriented)
apps/api/            AWS Lambda handlers
packages/domain/     Framework-independent business logic + domain model
packages/contracts/  Zod schemas — the source of truth for API types
packages/api-client/ Typed client consumed by the web app
packages/utils/
packages/config/
infrastructure/cdk/  AWS CDK stacks
```

## Architecture principles (non-negotiable)

These come from `AGENTS.md` and `ARCHITECTURE.md` and are the rules most likely to be violated:

- **Clean Architecture / dependency direction:** `packages/domain` is framework-independent and **must not import the AWS SDK** or any infrastructure concern. Business logic lives in `domain`; Lambda handlers are **thin** adapters that parse input, call the application/domain layer, and shape the response. Request flow: API Gateway → Lambda → Application → Repository → DynamoDB.
- **Zod is the contract source of truth.** Define request/response shapes as Zod schemas in `packages/contracts`, then derive TypeScript types with `z.infer`. Do not hand-write types that duplicate a schema.
- **Strict TypeScript, never `any`.** Prefer `type` aliases; use `interface` only for service abstractions (e.g. repository ports).
- **Stateless backend.** No per-request server state.
- **Uploads bypass the API:** the browser requests a pre-signed S3 URL (`POST /attachments/presign`) and uploads directly to S3. Do not stream file bytes through Lambda.
- **Never leave TODO/stub implementations** — generate production-ready code.

## REST API surface (MVP)

```
GET/POST         /cars
PUT/DELETE       /cars/{id}
GET/POST         /cars/{id}/events
GET/PUT/DELETE   /events/{id}
POST             /attachments/presign
```

## Domain model

`Garage` owns many `Car`s. A `Car` has a maintenance plan, `Event`s, and `Reminder`s. An `Event` (category, mileage, cost, date) contains `Work`s and attachments. A `Work` is a maintenance action with optional `PartUsage` (brand, name, part number, quantity, notes, purchase link). `Reminder`s are date- or mileage-based. Model these boundaries when designing DynamoDB keys and repositories.

## Frontend conventions

Material UI only, mobile-first, cards over tables, a floating action button to add events, light and dark themes. Structure the frontend feature-first (not layer-first). Screens: Login, Garage, Vehicle, Event Details, Add Event, Reminders.

## Workflow conventions

From `CONTRIBUTING.md`: feature branches, conventional commits, PRs required, ESLint + Prettier, TS strict mode, unit tests for business logic (i.e. `packages/domain`).

## AWS credentials

Use the **`yevhenii`** AWS CLI profile (region `us-east-1`) for all AWS operations — CDK deploy/synth/diff, S3, DynamoDB, Cognito, etc. Either pass `--profile yevhenii` or export `AWS_PROFILE=yevhenii` for the session. CDK commands should run as e.g. `cdk deploy --profile yevhenii`.

## Commands

- Install: `pnpm install`
- All gates: `pnpm turbo run build lint typecheck test`
- Single package test: `pnpm --filter @carlog/domain test`
- Single test file: `pnpm --filter @carlog/domain test src/car.test.ts`
- Web dev server: `pnpm --filter @carlog/web dev`
- CDK synth: `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk synth`
- Deploy backend: `AWS_PROFILE=yevhenii CDK_DEFAULT_REGION=us-east-1 pnpm --filter @carlog/cdk exec cdk deploy --require-approval never`
- Deploy web (build + reconcile Cognito URLs + S3 sync + CloudFront invalidate): `./scripts/deploy-web.sh`
- Teardown: `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk exec cdk destroy`

Live MVP thin-slice deployment (us-east-1): web at the `WebUrl` stack output (CloudFront), API at `ApiUrl`. The API is protected by a Cognito JWT authorizer; unauthenticated requests return 401. Auth uses the Cognito Hosted UI. Infra is cost-tuned: DynamoDB on-demand, CloudFront PRICE_CLASS_100, Lambda 256 MB, API Gateway stage throttling (20 req/s, burst 40). `apps/web/.env.production` is generated by `deploy-web.sh` from stack outputs and is gitignored.

The per-car AI chat is **agentic**: a bounded tool loop in `packages/domain` (`chatAboutCar`, max 3 model calls / 26s budget) lets the model create/update reminders, events, and car details and query the full timeline; deletes are only *proposed* as `pending` actions the owner confirms in-chat (`.../actions/{aid}/confirm|decline`). Tool execution is `DomainChatToolExecutor` in `apps/api` — `ownerId`/`carId` always come from the JWT context, never from tool input. The chat composer supports browser-native voice dictation (Web Speech API, no backend).