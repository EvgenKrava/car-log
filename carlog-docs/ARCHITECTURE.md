# Architecture

## Repository

```text
apps/
  web/
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
