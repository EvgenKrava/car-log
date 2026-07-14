# LLM Service + AI Timeline Import — Design

**Date:** 2026-07-14
**Status:** Approved (brainstorming) → ready for implementation plan
**Builds on:** the deployed service-history stack (Events → Works → PartUsage), the
`POST /cars/{id}/events` create route, and the clean-architecture repository/port
pattern already in the codebase.

## Goal

Introduce a **reusable, pluggable LLM service** (default backend: Claude via the
Anthropic SDK's Bedrock client, bearer-token auth) and prove it with its first
use case: **AI timeline import**. A user pastes free text (e.g. an old paper
logbook, a mechanic's notes) into a dialog; the LLM extracts structured candidate
Events (with Works and PartUsage); the user reviews and edits them; on confirm the
browser creates each via the existing event-create route. The LLM never writes to
the database.

## Locked Decisions

| Area | Decision |
|------|----------|
| First use case | AI timeline import — free text in, structured candidate Events out |
| Package layout | **Port + use-case in `packages/domain`** (pure, AWS-free); **Bedrock adapter in `apps/api`** (beside the Dynamo repos). Mirrors `CarRepository` port + `DynamoCarRepository` adapter. |
| Write flow | **Extract-only.** The endpoint returns validated candidate events; the browser commits them via the EXISTING `POST /cars/{id}/events` route after human review. No server-side write, no bulk endpoint, no draft state. |
| Bedrock credential | `AWS_BEARER_TOKEN_BEDROCK` injected by CDK from SSM SecureString `/carlog/bedrock-bearer-token` via `SecretValue.ssmSecure(...)`. Same pattern as the Google client secret. Never in repo/synth. |
| Review UI | Editable list + confirm — paste → Extract → editable candidate cards (reuse the existing EventFormDialog fields) → user tweaks/deletes → "Add N events" commits via existing route. |
| Provider default | Claude `anthropic.claude-opus-4-8` on Bedrock via `AnthropicBedrockMantle` (`@anthropic-ai/bedrock-sdk`). Provider is pluggable behind the port; other providers may be added later. |
| Input/output bounds | Input text ≤ 10,000 chars (Zod); output ≤ 50 events. |

## Architecture & Boundaries

Clean-architecture dependency direction is preserved. `packages/domain` stays
framework- and AWS-independent.

```
packages/domain/src/
  llm-provider.ts       // PORT: LlmProvider interface + ExtractionContext type (pure)
  extract-events.ts     // USE-CASE (pure): text + provider + car ctx
                        //   → build prompt → provider.extractEvents(...)
                        //   → validate raw JSON against CandidateEvent[] (+ 1 retry)
                        //   → return validated candidates OR typed failure
  extract-events.test.ts

packages/contracts/src/
  import.ts             // Zod: ExtractEventsRequest, ExtractEventsResponse,
                        //      CandidateEvent (= existing event-create body schema)
  import.test.ts
  index.ts              // re-export

apps/api/src/
  bedrock-llm-provider.ts  // ADAPTER: AnthropicBedrockMantle, bearer-token auth,
                           //   tool-use/structured output. Implements LlmProvider.
  llm-routes.ts            // THIN handler for POST /import/extract
  router.ts                // wire route + add `llm: LlmProvider` to RouteDeps
  handler.ts               // construct BedrockLlmProvider, add to deps
  in-memory-llm-provider.ts // fake provider for API/router tests (deterministic)

infrastructure/cdk/lib/carlog-stack.ts
                        // POST /import/extract route → Lambda; inject
                        //   AWS_BEARER_TOKEN_BEDROCK from SSM; grant read

apps/web/src/
  api-client.ts         // extractEvents(text) → ExtractEventsResponse
  queries.ts (or feature hook) // useExtractEvents mutation
  components/ImportEventsDialog.tsx // paste → extract → editable review → commit
  i18n/locales/{en,uk}/import.json  // new `import` namespace
```

**Model IDs carry the `anthropic.` prefix on Bedrock.** The `claude-api` skill is
invoked at implementation time to confirm the exact client class, model id, adaptive-
thinking params (`thinking: { type: 'adaptive' }`, `output_config.effort` — NOT
`budget_tokens`/temperature), and structured-output/tool-use shape — not written from
memory.

## Data Flow (extract-only)

```
Web: "Import from text" (button on the Vehicle / timeline screen)
  → ImportEventsDialog: paste text
  → POST /import/extract  { text }            (Cognito JWT — same authorizer)
    → llm-routes.ts (thin): ownerId guard, ExtractEventsRequest.parse(body)
      → extractEvents(text, deps.llm, { car })   [pure domain use-case]
        → build prompt + tool/output schema
        → deps.llm.extractEvents(text, ctx)       [Bedrock adapter → Claude]
        → validate raw JSON against z.array(CandidateEvent).max(50)
            (on parse failure: ONE bounded retry with a "valid JSON only" nudge)
      ← ok(200, { events: CandidateEvent[] })
  → review dialog shows editable candidate cards (EventFormDialog fields)
  → user edits / deletes cards, clicks "Add N events"
  → browser loops POST /cars/{id}/events   (EXISTING route + EXISTING validation)
  → timeline query invalidated → new events appear
```

The LLM path is stateless and side-effect-free; only the existing, already-validated
create route mutates data. A candidate that survives review is POSTed verbatim — no
field remapping, because `CandidateEvent` **is** the create-route body schema.

## Contract Shapes (`packages/contracts/src/import.ts`)

Derived from the existing event schemas — no hand-written duplicates.

```ts
import { z } from 'zod';
import { <event-create body schema> } from './event'; // the schema POST /events already parses

export const ExtractEventsRequest = z.object({
  text: z.string().min(1).max(10_000),   // bounds tokens/cost
});
export type ExtractEventsRequest = z.infer<typeof ExtractEventsRequest>;

// A CandidateEvent is an Event the user hasn't committed: the create-route body
// (category, date, mileage, cost, currency, works[], parts...) WITHOUT server-assigned
// id/carId/createdAt. It equals the schema the create route already accepts.
export const CandidateEvent = <event-create body schema>;
export type CandidateEvent = z.infer<typeof CandidateEvent>;

export const ExtractEventsResponse = z.object({
  events: z.array(CandidateEvent).max(50),
});
export type ExtractEventsResponse = z.infer<typeof ExtractEventsResponse>;
```

The plan's Task 1 must confirm the exact name of the existing event-create body schema
in `packages/contracts/src/event.ts` and reuse it (do not redefine event fields).

## Provider Port (`packages/domain/src/llm-provider.ts`)

```ts
export type ExtractionContext = {
  car: { make: string; model: string; year?: number };
};

export interface LlmProvider {
  // Returns the model's raw structured output as unknown JSON.
  // The use-case (extract-events.ts) validates it against the contract schema —
  // the provider is not responsible for schema conformance.
  extractEvents(text: string, ctx: ExtractionContext): Promise<unknown>;
}
```

Kept deliberately narrow (one method) for v1. Additional capabilities (summary, OCR)
are added as new methods/ports when those features arrive — not now (YAGNI).

## Error Handling

All errors flow through the existing `withErrorHandling` wrapper to clean HTTP codes.

| Failure | Handling |
|---|---|
| Empty / >10k-char text | `ExtractEventsRequest` Zod rejection → **400** before any Bedrock call |
| Model JSON malformed / non-conforming | Use-case validates; on failure, **one bounded retry** with a "return valid JSON only" nudge; still failing → **422 `ExtractionFailed`** (never a partial/garbage list) |
| Model emits unknown category / bad enum for an item | That item dropped during validation; only schema-valid events returned (review dialog never shows an uncommittable card) |
| Bedrock throttled / 5xx / timeout | Adapter throws typed `LlmUnavailableError` → **503**; web preserves pasted text, offers "try again" |
| Missing / invalid bearer token at runtime | Adapter throws typed config error → **500**, logged; token value never logged or leaked |

New typed errors (`ExtractionFailedError`, `LlmUnavailableError`) live in
`apps/api/src/errors.ts` alongside the existing ones, mapped to their status codes.

## Cost & Abuse Guardrails

- Input ≤ 10k chars, output ≤ 50 events (bounds token spend).
- Structured-output / tool-use forces the exact JSON shape → no prose, fewer retries.
- Adaptive thinking (`thinking: { type: 'adaptive' }`) + `output_config.effort` control
  depth without `budget_tokens` (rejected on Opus 4.8).
- Reuses the existing API Gateway stage throttle (20 r/s, burst 40). No per-user LLM
  quota in v1 (YAGNI); flagged as a future add if the endpoint is abused.
- Lambda memory/timeout: the extract handler may need a higher timeout than the CRUD
  Lambda (LLM round-trip). The plan sets an explicit timeout (e.g. 30s) on the route's
  integration; keep memory at the existing 256 MB unless synth/live shows a need.

## Testing

- **Domain `extract-events.ts` (pure, unit-tested with a fake `LlmProvider`):**
  valid JSON → validated events; malformed JSON → retry → success; malformed twice →
  `ExtractionFailed`; empty model output → empty list; one bad-enum item among valid →
  dropped, rest returned; >50 events → rejected/capped.
- **Contracts:** `ExtractEventsRequest` bounds (min 1, max 10k), `ExtractEventsResponse`
  50-cap, `CandidateEvent` matches the create-route body.
- **API/router:** `POST /import/extract` happy path + 400/422/503 via the in-memory fake
  provider (no network, no AWS).
- **Adapter (`bedrock-llm-provider.ts`):** NOT unit-tested against live Bedrock — it's the
  integration boundary. Verified by the live smoke test.
- **Gates:** `pnpm turbo run typecheck lint test` green; `grep -c execute-api dist/sw.js == 0`.

## Prerequisites (user manual steps — blocking for live verification)

1. **Create a Bedrock API key** (the local Claude Code token is NOT a Bedrock bearer
   token): `aws bedrock create-api-key ...` (or the AWS console), then store it:
   `aws ssm put-parameter --profile yevhenii --region us-east-1 --name /carlog/bedrock-bearer-token --type SecureString --value '<token>'`
2. **Confirm Bedrock model access** for `anthropic.claude-opus-4-8` is enabled in
   `us-east-1` for account 898836755334 (Bedrock console → Model access).

## Verification (definition of done)

Deploy backend (`cdk deploy`) then web (`deploy-web.sh`). On the deployed app:
1. Open a car → "Import from text" → paste a sample multi-entry logbook → Extract.
2. Candidate events appear as editable cards; fields (date, mileage, cost, works, parts)
   are populated plausibly; edit one, delete one.
3. "Add N events" → the events appear on the timeline (created via the existing route).
4. Paste empty / oversized text → 400 handled gracefully; force a bad extraction →
   422 message, pasted text preserved.
5. EN⇄UK translates the dialog strings.
6. The bearer token never appears in the frontend bundle, synth output, or logs.

## Scope Guard (YAGNI)

Out of scope for v1: server-side bulk insert, draft/staged events, AI summary/export,
OCR/vision extraction of uploaded proofs, per-user LLM quota, streaming responses,
multi-provider selection UI, conversation/assistant mode. The port is designed so
these become additive later without reworking the boundary.

## Parallel-safety

This feature is largely additive and backend-heavy (new domain files, new contracts
module, new API adapter/route, one new CDK route, one new web dialog + `import` i18n
namespace). If run concurrently with other frontend work, its only shared-file touch
points are `router.ts`/`handler.ts`/`errors.ts` (backend), `carlog-stack.ts` (CDK),
and `api-client.ts`/`main.tsx`/`queries.ts` (web wiring) — coordinate those with any
concurrent worktree. Recommend building this on its own branch after the current
Google-signin + batch-upload merges land, to avoid `carlog-stack.ts` /
`api-client.ts` collisions.

## Files (anticipated)

```
packages/domain/src/llm-provider.ts               CREATE  port + ExtractionContext
packages/domain/src/extract-events.ts             CREATE  pure use-case
packages/domain/src/extract-events.test.ts        CREATE  unit tests (fake provider)
packages/domain/src/index.ts                      MODIFY  re-export
packages/contracts/src/import.ts                  CREATE  request/response/candidate schemas
packages/contracts/src/import.test.ts             CREATE  schema bound tests
packages/contracts/src/index.ts                   MODIFY  re-export
apps/api/src/bedrock-llm-provider.ts              CREATE  Anthropic Bedrock adapter
apps/api/src/in-memory-llm-provider.ts            CREATE  deterministic fake for tests
apps/api/src/llm-routes.ts                        CREATE  POST /import/extract handler
apps/api/src/router.ts                            MODIFY  wire route + RouteDeps.llm
apps/api/src/handler.ts                           MODIFY  construct adapter into deps
apps/api/src/errors.ts                            MODIFY  ExtractionFailed/LlmUnavailable
apps/api/package.json                             MODIFY  add @anthropic-ai/bedrock-sdk
infrastructure/cdk/lib/carlog-stack.ts            MODIFY  route + SSM token env + grant + timeout
apps/web/src/api-client.ts                        MODIFY  extractEvents(text)
apps/web/src/queries.ts                           MODIFY  useExtractEvents mutation
apps/web/src/components/ImportEventsDialog.tsx    CREATE  paste → extract → review → commit
apps/web/src/i18n/locales/en/import.json          CREATE  dialog strings
apps/web/src/i18n/locales/uk/import.json          CREATE  dialog strings
apps/web/src/i18n/index.ts (namespace registration) MODIFY  register `import` namespace
```
