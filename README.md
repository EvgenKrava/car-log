# CarLog

> A web-first digital service book. Vehicle owners keep the full maintenance history of every car they own in one searchable timeline — replacing notebooks, paper invoices, and scattered photos.

### 🚀 Live demo

**[https://dkn291e7rr9st.cloudfront.net](https://dkn291e7rr9st.cloudfront.net)**

Hosted on AWS CloudFront (region `us-east-1`). Create an account or sign in to try it — add a car, log a service event, attach a receipt, and set a reminder.

---

## ✨ Features

- **Garage of multiple cars** — keep every vehicle you own in one account, each with its own identity and derived dashboard.
- **Service timeline** — the primary screen: a chronological, searchable history of everything that's happened to a car.
- **Rich maintenance events** — record category, mileage, cost, and date; break an event into individual works, each with optional part usage (brand, name, part number, quantity, notes, purchase link).
- **Photo & PDF attachments** — keep receipts, invoices, and photos with each event. Files upload directly to S3 via pre-signed URLs.
- **Reminders** — date- or mileage-based, with due and overdue badges, and one-tap completion that can roll into the next interval.
- **AI invoice scan** — snap or upload an invoice and let the assistant pre-fill an event for you.
- **Bulk text import** — paste service history as text and turn it into structured events.
- **Installable PWA** — an install prompt lets you add CarLog to your home screen for an app-like experience.
- **English & Ukrainian** — full i18n, switchable in profile settings.
- **Light & dark themes** — mobile-first Material UI throughout.

## 🧱 Tech stack

**Frontend**
- React + TypeScript + Material UI
- TanStack Query (server state), React Hook Form (forms), Zod (validation)

**Backend**
- AWS Lambda (TypeScript) behind API Gateway
- DynamoDB (single-table, on-demand)
- Amazon S3 with pre-signed uploads
- Amazon Cognito for authentication (JWT authorizer)

**Infrastructure & tooling**
- AWS CDK
- pnpm workspaces + Turborepo

The public API base is `https://p3jvopg34d.execute-api.us-east-1.amazonaws.com` (protected by a Cognito JWT authorizer; unauthenticated requests return `401`).

## 📁 Monorepo layout

```text
apps/
  web/                React frontend (feature-oriented)
  api/                AWS Lambda handlers (thin adapters)

packages/
  domain/             Framework-independent business logic + domain model
  contracts/          Zod schemas — the source of truth for API types
  config/             Shared configuration

infrastructure/
  cdk/                AWS CDK stacks
```

## 🛠️ Getting started (local dev)

```bash
# Install dependencies (from the repo root)
pnpm install

# Run the web dev server
pnpm --filter @carlog/web dev

# Run all quality gates
pnpm turbo run build lint typecheck test
```

Useful scoped commands:

```bash
# Test a single package
pnpm --filter @carlog/domain test

# Test a single file
pnpm --filter @carlog/domain test src/car.test.ts
```

## 🏛️ Architecture

CarLog follows Clean Architecture with a strict dependency direction:

- **`packages/domain` is framework-independent** — it holds the business logic and domain model (`Garage → Car → Event → Work → PartUsage`, plus `Reminder`) and never imports the AWS SDK or any infrastructure concern.
- **Lambda handlers are thin adapters** — they parse input, call the application/domain layer, and shape the response. Request flow: API Gateway → Lambda → Application → Repository → DynamoDB.
- **Zod is the contract source of truth** — request/response shapes live as Zod schemas in `packages/contracts`, with TypeScript types derived via `z.infer` rather than hand-written.
- **Uploads bypass the API** — the browser requests a pre-signed S3 URL and uploads bytes directly to S3, so file data never streams through Lambda.
- The backend is **stateless**; the frontend is **feature-first**, not layer-first.

## ☁️ Deployment

All AWS operations use the `yevhenii` CLI profile in region `us-east-1`.

```bash
# Deploy the backend (CDK)
AWS_PROFILE=yevhenii CDK_DEFAULT_REGION=us-east-1 \
  pnpm --filter @carlog/cdk exec cdk deploy --require-approval never

# Deploy the web app
# (build + reconcile Cognito URLs + S3 sync + CloudFront invalidate)
./scripts/deploy-web.sh
```

The live deployment serves the web app from the CloudFront `WebUrl` stack output and the API from the `ApiUrl` output. Infrastructure is cost-tuned: DynamoDB on-demand, CloudFront `PRICE_CLASS_100`, 256 MB Lambdas, and API Gateway stage throttling.