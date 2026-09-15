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
  config/

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

## Principles

- Stateless backend
- Clean Architecture
- Feature-oriented frontend
