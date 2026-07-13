# AI Development Rules

## General

- Generate production-ready code.
- Never leave TODO implementations.
- Use strict TypeScript.
- Never use `any`.
- Prefer `type` over `interface`.
- Use `interface` only for service abstractions.
- Use Zod as the source of truth for API contracts.
- Generate types using `z.infer`.

## Architecture

- Thin Lambda handlers.
- Business logic must not depend on AWS SDK.
- Domain must be framework independent.

## Frontend

- React
- Material UI
- TanStack Query
- React Hook Form
- Zod

## Backend

- AWS Lambda
- API Gateway
- DynamoDB
- S3 pre-signed uploads
- Cognito authentication
