# Architecture Decision Records

ADR-001: AWS Lambda for low operational cost.

ADR-002: DynamoDB for serverless scalability.

ADR-003: TypeScript across the full stack.

ADR-004: Material UI for rapid MVP development.

ADR-005: Zod + z.infer as the source of truth for API contracts.

ADR-006: The AI provider is an admin setting, not a deploy-time choice. Chat, invoice
scanning and text import run on Claude through either Amazon Bedrock (Lambda role, SigV4)
or the Claude API (a Console API key). One adapter (`ClaudeLlmProvider`) serves both,
since both expose the same Messages API. The choice lives in DynamoDB (`APP#settings`/`AI`)
and the key in an SSM SecureString (`/carlog/anthropic-api-key`, standard tier, free);
each Lambda re-reads them at most once a minute. Default until saved: Bedrock + Haiku 4.5.
Claude Pro/Max subscription tokens are rejected: they are licensed for Claude's own apps,
not for a service other people use.
