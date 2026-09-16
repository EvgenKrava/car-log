# Architecture

## Repository

```text
apps/
  web/
  site/           Astro marketing site (static, served alongside the SPA)
  api/

packages/
  domain/
  contracts/
  api-client/
  utils/
  config/         shared tsconfig + the app-route list (SW allowlist, robots.txt, CloudFront)

infrastructure/
  cdk/
```

## Backend Flow

Browser
→ API Gateway
→ Lambda
→ Application
→ Repository
→ DynamoDB

Uploads:
Browser
→ Pre-signed URL
→ Amazon S3

## Web Flow

One S3 bucket + CloudFront distribution serves the marketing site (`/`, `/uk/`, `/privacy`, …)
and the SPA shell (`app.html`). A viewer-request Function routes by URI:

- app route (`packages/config/app-routes.ts`) → `app.html`
- `/`, `/uk/`, extensionless site page → `<dir>/index.html`
- anything else → untouched; a missing key is a real HTTP 404 with the site's `404.html`

## Principles

- Stateless backend
- Clean Architecture
- Feature-oriented frontend
