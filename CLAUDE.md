# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

CarLog is live and part of Only Tools. `carlog-docs/` holds the original design docs; the code is the source of truth where they differ.

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
- **Infra:** Terraform (`infra/main`, state in the shared Only Tools bucket under `carlog/main.tfstate`)

## Intended repository layout

```
apps/web/            React frontend (feature-oriented)
apps/api/            AWS Lambda handlers
packages/domain/     Framework-independent business logic + domain model
packages/contracts/  Zod schemas — the source of truth for API types
packages/api-client/ Typed client consumed by the web app
packages/utils/
packages/config/
infra/main/          Terraform
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
- Regenerate app icons (light + dark sets, favicon, apple-touch, maskable/monochrome) from the vector mark in `apps/web/scripts/icons.mjs`: `pnpm --filter @carlog/web icons` (needs `rsvg-convert`, `brew install librsvg`)
- Deploy everything (API bundle → `terraform apply` → web build → S3 + CloudFront): `./scripts/deploy.sh`
- Deploy the web app only: `./scripts/deploy.sh web`
- Plan infra: `AWS_PROFILE=yevhenii terraform -chdir=infra/main plan`

Live at https://carlog.onlytools.click (us-east-1), built by Terraform. Sign-in is the shared Only Tools account (Cognito pool behind auth.onlytools.click, client `carlog`); the API's JWT authorizer trusts that pool, `carlog-user` opens the app and `carlog-admin` the admin pages. CarLog never deletes or disables an Only Tools account; deleting a CarLog user purges their data and removes the CarLog roles. Data from the old CDK stack's own pool moves to the user's new sub on their first `GET /me` (`apps/api/src/legacy-claim.ts`, markers `LEGACY#<email>` written by `apps/api/scripts/copy-legacy.ts`). onlytools.click is the only landing: this host serves just the SPA (`app.html` for every extensionless path, robots `Disallow: /`). Infra is cost-tuned: DynamoDB on-demand with point-in-time recovery, CloudFront PriceClass_100, Lambda 256 MB on Node.js 24 (arm64), API Gateway throttling (20 req/s, burst 40). `apps/web/.env.production` is written by `deploy.sh` from Terraform outputs and is gitignored.

The per-car AI chat is **agentic**: a bounded tool loop in `packages/domain` (`chatAboutCar`, max 3 model calls / 26s budget) lets the model create/update reminders, events, and car details and query the full timeline; deletes are only *proposed* as `pending` actions the owner confirms in-chat (`.../actions/{aid}/confirm|decline`). Tool execution is `DomainChatToolExecutor` in `apps/api` — `ownerId`/`carId` always come from the JWT context, never from tool input. The chat composer supports browser-native voice dictation (Web Speech API, no backend).

AI calls (chat, invoice scanning, text import) go to Claude through **either Amazon Bedrock or the Claude API**, picked at runtime by an admin on `/admin/ai` (provider + model, plus a write-only Claude API key). One adapter, `ClaudeLlmProvider` in `apps/api`, serves both; `SwitchableLlmProvider` re-reads the choice (DynamoDB `APP#settings`/`AI`) and the key (SSM SecureString `/carlog/anthropic-api-key`, created by the API on first save) at most once a minute. Model ids per provider live in `apps/api/src/ai-models.ts`; keep the Bedrock ones in sync with the stack's Bedrock IAM policy. Default until saved: Bedrock + Haiku 4.5.