# LLM Service + AI Timeline Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pluggable LLM service (Claude via the Anthropic SDK's Bedrock client, bearer-token auth) and its first use case — AI timeline import: paste free text → LLM extracts structured candidate Events → user reviews/edits → browser commits them via the existing `POST /cars/{id}/events` route.

**Architecture:** Clean-architecture split, mirroring the repository/port pattern. A pure `LlmProvider` port + pure `extractEvents` use-case live in `packages/domain` (AWS-free). The `AnthropicBedrockMantle` adapter + a thin `POST /import/extract` handler live in `apps/api`. Extract-only — the LLM never writes to DynamoDB; the browser reuses the already-shipped, already-validated event-create route after human review.

**Tech Stack:** TypeScript (strict), Zod (contract source of truth), `@anthropic-ai/bedrock-sdk` (`AnthropicBedrockMantle`), AWS CDK, React 18 + MUI v6 + TanStack Query + react-i18next, Vitest.

## Global Constraints

- **Clean architecture:** `packages/domain` MUST NOT import the AWS SDK or any infrastructure concern. The `LlmProvider` port + `extractEvents` use-case are pure. The Bedrock adapter lives in `apps/api` only.
- **Zod is the contract source of truth.** `CandidateEvent` = the EXISTING `CreateEventSchema` from `@carlog/contracts` — do NOT redefine event fields. Derive TS types with `z.infer`.
- **Strict TS, never `any`.** Prefer `type` aliases; `interface` only for the provider port.
- **LLM SDK rule (user global):** use the Anthropic SDK's Bedrock client `AnthropicBedrockMantle` from `@anthropic-ai/bedrock-sdk` — NOT raw HTTP, NOT `@aws-sdk/client-bedrock-runtime`. Auth via `AWS_BEARER_TOKEN_BEDROCK` env (never hardcoded). Model id carries the `anthropic.` prefix: `anthropic.claude-opus-4-8`. Use adaptive thinking `thinking: { type: 'adaptive' }` + `output_config.effort` — NEVER `budget_tokens`/`temperature`/`top_p` (rejected 400 on Opus 4.8). **Task 4 MUST invoke the `claude-api` skill before writing SDK calls** to confirm the current client class, model id, tool-use/structured-output shape, and param names — do not write them from memory.
- **Extract-only:** the endpoint returns candidates; the LLM never writes to Dynamo. No bulk-write, no draft state.
- **Bounds:** input text ≤ 10,000 chars (Zod); output ≤ 50 events.
- **Secrets never in repo/synth/bundle.** The Bedrock token comes from SSM SecureString `/carlog/bedrock-bearer-token`, injected by CDK via `SecretValue.ssmSecure(...)`. Never log the token.
- **AWS profile `yevhenii`, region `us-east-1`** for all AWS ops.
- **Conventional commits; NEVER add any `Co-Authored-By` / "Generated with Claude" trailer.**
- **Strings via `t()`, EN + UK both.** MUI only. Extensionless relative imports (match neighbors).
- **SW guard:** after web build, `grep -c execute-api apps/web/dist/sw.js` MUST be `0`.

## File Structure

```
packages/contracts/src/import.ts          CREATE  ExtractEventsRequest/Response, CandidateEvent (=CreateEventSchema)
packages/contracts/src/import.test.ts     CREATE  schema-bound tests
packages/contracts/src/index.ts           MODIFY  export * from './import'
packages/domain/src/llm-provider.ts       CREATE  LlmProvider port + ExtractionContext type
packages/domain/src/extract-events.ts     CREATE  pure use-case (prompt, provider call, validate, 1 retry)
packages/domain/src/extract-events.test.ts CREATE  unit tests w/ fake provider
packages/domain/src/index.ts              MODIFY  export the port + use-case + errors
apps/api/src/llm-errors.ts                CREATE  ExtractionFailedError, LlmUnavailableError (typed)
apps/api/src/errors.ts                    MODIFY  map new errors → 422 / 503
apps/api/src/in-memory-llm-provider.ts    CREATE  deterministic fake for router tests
apps/api/src/llm-routes.ts                CREATE  POST /import/extract handler
apps/api/src/router.ts                    MODIFY  wire route + RouteDeps.llm
apps/api/src/router.test.ts               MODIFY  extract-route tests
apps/api/src/bedrock-llm-provider.ts      CREATE  AnthropicBedrockMantle adapter
apps/api/src/handler.ts                   MODIFY  construct adapter into deps
apps/api/package.json                     MODIFY  add @anthropic-ai/bedrock-sdk
infrastructure/cdk/lib/carlog-stack.ts    MODIFY  route + SSM token env + timeout bump
apps/web/src/api-client.ts                MODIFY  extractEvents(token, text)
apps/web/src/queries.ts                   MODIFY  useExtractEvents mutation
apps/web/src/components/ImportEventsDialog.tsx  CREATE  paste → extract → editable review → commit
apps/web/src/routes/Vehicle.tsx           MODIFY  "Import from text" trigger button
apps/web/src/i18n/locales/en/import.json  CREATE
apps/web/src/i18n/locales/uk/import.json  CREATE
apps/web/src/i18n/index.ts                MODIFY  register `import` namespace
```

Order: contracts (1) → domain port+use-case (2) → api errors+fake+route+router-tests (3) → bedrock adapter+handler (4) → CDK (5) → web client+queries+i18n (6) → dialog+trigger (7) → verify+deploy (8).

---

### Task 1: Contracts — extraction request/response schemas

**Files:**
- Create: `packages/contracts/src/import.ts`, `packages/contracts/src/import.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: existing `CreateEventSchema` from `./event` (fields: `date` YYYY-MM-DD, `mileage` int≥0, `cost`≥0, `currency` default 'UAH', `category` enum, `title?`, `notes?`, `works[]` default []).
- Produces:
  - `CandidateEventSchema` (= `CreateEventSchema`), type `CandidateEvent`
  - `ExtractEventsRequestSchema` = `z.object({ text: z.string().min(1).max(10_000) })`, type `ExtractEventsRequest`
  - `ExtractEventsResponseSchema` = `z.object({ events: z.array(CandidateEventSchema).max(50) })`, type `ExtractEventsResponse`

- [ ] **Step 1: Write the failing test — `packages/contracts/src/import.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { ExtractEventsRequestSchema, ExtractEventsResponseSchema, CandidateEventSchema } from './import';

describe('ExtractEventsRequestSchema', () => {
  it('accepts non-empty text under 10k chars', () => {
    expect(ExtractEventsRequestSchema.parse({ text: 'oil change at 45000km' })).toEqual({ text: 'oil change at 45000km' });
  });
  it('rejects empty text', () => {
    expect(ExtractEventsRequestSchema.safeParse({ text: '' }).success).toBe(false);
  });
  it('rejects text over 10k chars', () => {
    expect(ExtractEventsRequestSchema.safeParse({ text: 'a'.repeat(10_001) }).success).toBe(false);
  });
});

describe('CandidateEventSchema', () => {
  it('equals the create-event body: parses a full candidate and defaults works/currency', () => {
    const parsed = CandidateEventSchema.parse({ date: '2024-01-15', mileage: 45000, cost: 1200, category: 'oil_change' });
    expect(parsed).toMatchObject({ category: 'oil_change', currency: 'UAH', works: [] });
  });
});

describe('ExtractEventsResponseSchema', () => {
  it('accepts a list of candidate events', () => {
    const r = ExtractEventsResponseSchema.parse({ events: [{ date: '2024-01-15', mileage: 45000, cost: 1200, category: 'oil_change' }] });
    expect(r.events).toHaveLength(1);
  });
  it('rejects more than 50 events', () => {
    const one = { date: '2024-01-15', mileage: 1, cost: 1, category: 'other' };
    expect(ExtractEventsResponseSchema.safeParse({ events: Array.from({ length: 51 }, () => one) }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/contracts test`
Expected: FAIL — cannot resolve `./import`.

- [ ] **Step 3: Create `packages/contracts/src/import.ts`**

```ts
import { z } from 'zod';
import { CreateEventSchema } from './event';

// A CandidateEvent is an Event the user has NOT committed yet: exactly the body the
// existing `POST /cars/{id}/events` route accepts (CreateEventSchema), so a reviewed
// candidate is POSTed verbatim with no field remapping.
export const CandidateEventSchema = CreateEventSchema;
export type CandidateEvent = z.infer<typeof CandidateEventSchema>;

export const ExtractEventsRequestSchema = z.object({
  text: z.string().min(1).max(10_000),
});
export type ExtractEventsRequest = z.infer<typeof ExtractEventsRequestSchema>;

export const ExtractEventsResponseSchema = z.object({
  events: z.array(CandidateEventSchema).max(50),
});
export type ExtractEventsResponse = z.infer<typeof ExtractEventsResponseSchema>;
```

- [ ] **Step 4: Export from `packages/contracts/src/index.ts`**

Add the line (after the existing exports):

```ts
export * from './import';
```

- [ ] **Step 5: Run test to verify it passes + typecheck**

Run: `pnpm --filter @carlog/contracts test && pnpm --filter @carlog/contracts typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/import.ts packages/contracts/src/import.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add AI timeline import request/response schemas"
```

---

### Task 2: Domain — LlmProvider port + pure extractEvents use-case

**Files:**
- Create: `packages/domain/src/llm-provider.ts`, `packages/domain/src/extract-events.ts`, `packages/domain/src/extract-events.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `CandidateEventSchema`, `ExtractEventsResponseSchema`, type `CandidateEvent` from `@carlog/contracts` (Task 1).
- Produces:
  - `type ExtractionContext = { car: { make: string; model: string; year?: number } }`
  - `interface LlmProvider { extractEvents(text: string, ctx: ExtractionContext): Promise<unknown> }`
  - `class ExtractionFailedError extends Error` (domain-level; thrown when the model output can't be validated after one retry)
  - `async function extractEvents(text: string, provider: LlmProvider, ctx: ExtractionContext): Promise<CandidateEvent[]>` — calls the provider, validates raw output, drops invalid items, retries once on total failure, throws `ExtractionFailedError` if still unusable.

**Validation contract:** the provider returns `unknown` (raw model JSON). The use-case expects `{ events: unknown[] }` OR a bare `unknown[]`; it normalizes to an array, validates each item with `CandidateEventSchema.safeParse`, keeps the valid ones (dropping malformed items), and caps at 50. If the provider's output has NO array at all (not `{events:[...]}`, not `[...]`), that's a shape failure → retry once → `ExtractionFailedError`. An array that parses to zero valid items is a valid empty result (returns `[]`), NOT a failure.

- [ ] **Step 1: Create the port — `packages/domain/src/llm-provider.ts`**

```ts
export type ExtractionContext = {
  car: { make: string; model: string; year?: number };
};

export interface LlmProvider {
  // Returns the model's raw structured output as unknown JSON. The extractEvents
  // use-case validates it against the contract schema — the provider is NOT
  // responsible for schema conformance.
  extractEvents(text: string, ctx: ExtractionContext): Promise<unknown>;
}
```

- [ ] **Step 2: Write the failing test — `packages/domain/src/extract-events.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { extractEvents, ExtractionFailedError } from './extract-events';
import type { LlmProvider, ExtractionContext } from './llm-provider';

const ctx: ExtractionContext = { car: { make: 'Toyota', model: 'Corolla', year: 2020 } };
const valid = { date: '2024-01-15', mileage: 45000, cost: 1200, category: 'oil_change' };

const providerReturning = (...outputs: unknown[]): LlmProvider => {
  const fn = vi.fn();
  outputs.forEach((o) => fn.mockResolvedValueOnce(o));
  return { extractEvents: fn };
};

describe('extractEvents', () => {
  it('returns validated candidates from { events: [...] }', async () => {
    const out = await extractEvents('text', providerReturning({ events: [valid] }), ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ category: 'oil_change', currency: 'UAH', works: [] });
  });

  it('accepts a bare array output', async () => {
    const out = await extractEvents('text', providerReturning([valid, valid]), ctx);
    expect(out).toHaveLength(2);
  });

  it('drops malformed items but keeps valid ones', async () => {
    const out = await extractEvents('text', providerReturning({ events: [valid, { junk: true }] }), ctx);
    expect(out).toHaveLength(1);
  });

  it('returns [] when the model finds no events (valid empty array)', async () => {
    const out = await extractEvents('text', providerReturning({ events: [] }), ctx);
    expect(out).toEqual([]);
  });

  it('retries once on a shapeless first response, then succeeds', async () => {
    const provider = providerReturning('not json at all', { events: [valid] });
    const out = await extractEvents('text', provider, ctx);
    expect(out).toHaveLength(1);
    expect(provider.extractEvents).toHaveBeenCalledTimes(2);
  });

  it('throws ExtractionFailedError when both attempts are shapeless', async () => {
    const provider = providerReturning('garbage', 'still garbage');
    await expect(extractEvents('text', provider, ctx)).rejects.toBeInstanceOf(ExtractionFailedError);
    expect(provider.extractEvents).toHaveBeenCalledTimes(2);
  });

  it('caps output at 50 events', async () => {
    const many = Array.from({ length: 60 }, () => valid);
    const out = await extractEvents('text', providerReturning({ events: many }), ctx);
    expect(out).toHaveLength(50);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @carlog/domain test src/extract-events.test.ts`
Expected: FAIL — cannot resolve `./extract-events`.

- [ ] **Step 4: Implement `packages/domain/src/extract-events.ts`**

```ts
import { CandidateEventSchema, type CandidateEvent } from '@carlog/contracts';
import type { LlmProvider, ExtractionContext } from './llm-provider';

export class ExtractionFailedError extends Error {
  constructor(message = 'Could not extract events from the provided text') {
    super(message);
    this.name = 'ExtractionFailedError';
  }
}

const MAX_EVENTS = 50;

// Pull an array of candidate-event-shaped objects out of the model's raw output.
// Accepts `{ events: [...] }` or a bare `[...]`. Returns null when there is no array
// at all (a shape failure that warrants a retry).
function extractArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray((raw as { events?: unknown }).events)) {
    return (raw as { events: unknown[] }).events;
  }
  return null;
}

function validate(raw: unknown): CandidateEvent[] | null {
  const arr = extractArray(raw);
  if (arr === null) return null; // shapeless → caller retries
  const valid: CandidateEvent[] = [];
  for (const item of arr) {
    const parsed = CandidateEventSchema.safeParse(item);
    if (parsed.success) valid.push(parsed.data);
    if (valid.length >= MAX_EVENTS) break;
  }
  return valid;
}

export async function extractEvents(
  text: string,
  provider: LlmProvider,
  ctx: ExtractionContext,
): Promise<CandidateEvent[]> {
  const first = validate(await provider.extractEvents(text, ctx));
  if (first !== null) return first;
  // One bounded retry: the first response had no array at all.
  const second = validate(await provider.extractEvents(text, ctx));
  if (second !== null) return second;
  throw new ExtractionFailedError();
}
```

- [ ] **Step 5: Export from `packages/domain/src/index.ts`**

Add these lines:

```ts
export * from './llm-provider';
export { extractEvents, ExtractionFailedError } from './extract-events';
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @carlog/domain test && pnpm --filter @carlog/domain typecheck`
Expected: PASS (all 7 new extract-events tests + existing domain tests).

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/llm-provider.ts packages/domain/src/extract-events.ts packages/domain/src/extract-events.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): add LlmProvider port and pure extractEvents use-case"
```

---

### Task 3: API — errors, in-memory fake provider, extract route, router wiring

**Files:**
- Create: `apps/api/src/llm-errors.ts`, `apps/api/src/in-memory-llm-provider.ts`, `apps/api/src/llm-routes.ts`
- Modify: `apps/api/src/errors.ts`, `apps/api/src/router.ts`, `apps/api/src/router.test.ts`

**Interfaces:**
- Consumes: `extractEvents`, `ExtractionFailedError`, `LlmProvider`, `ExtractionContext` from `@carlog/domain` (Task 2); `ExtractEventsRequestSchema` from `@carlog/contracts` (Task 1); existing `ok`, `type ApiResult`, `withErrorHandling` from `./errors`; existing `RouteDeps`, `type ApiEvent` from `./router`; existing `CarRepository` (for car lookup) from `@carlog/domain`.
- Produces:
  - `class LlmUnavailableError extends Error` in `llm-errors.ts` (thrown by the adapter on Bedrock 5xx/throttle/network; Task 4 uses it)
  - `InMemoryLlmProvider` implementing `LlmProvider` — deterministic, configurable output for tests
  - `handleImportRoute(deps, event, ownerId): Promise<ApiResult | null>` — handles `POST /import/extract`
  - `RouteDeps` gains `llm: LlmProvider`

- [ ] **Step 1: Create `apps/api/src/llm-errors.ts`**

```ts
// Thrown by the Bedrock adapter when the model backend is unreachable / throttled /
// returns a 5xx. Distinct from the domain's ExtractionFailedError (bad model OUTPUT).
export class LlmUnavailableError extends Error {
  constructor(message = 'The AI service is temporarily unavailable') {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}
```

- [ ] **Step 2: Map the new errors in `apps/api/src/errors.ts`**

Add the import (extend the existing `@carlog/domain` import to include `ExtractionFailedError`, and add a new import line for the api-local error):

```ts
import { CarNotFoundError, CapExceededError, PhotoNotFoundError, EventNotFoundError, ProofNotFoundError, ExtractionFailedError } from '@carlog/domain';
import { LlmUnavailableError } from './llm-errors';
```

Add these two branches inside `withErrorHandling`, BEFORE the final `console.error`/500 fallback:

```ts
    if (err instanceof ExtractionFailedError) {
      return { statusCode: 422, headers: CORS, body: JSON.stringify({ error: 'ExtractionFailed', message: err.message }) };
    }
    if (err instanceof LlmUnavailableError) {
      return { statusCode: 503, headers: CORS, body: JSON.stringify({ error: 'LlmUnavailable', message: err.message }) };
    }
```

- [ ] **Step 3: Create `apps/api/src/in-memory-llm-provider.ts`**

```ts
import type { LlmProvider, ExtractionContext } from '@carlog/domain';

// Deterministic fake for tests. Configure with the raw output to return, or an Error
// to throw (to exercise the 503 path).
export class InMemoryLlmProvider implements LlmProvider {
  constructor(private readonly output: unknown, private readonly throwErr?: Error) {}
  async extractEvents(_text: string, _ctx: ExtractionContext): Promise<unknown> {
    if (this.throwErr) throw this.throwErr;
    return this.output;
  }
}
```

- [ ] **Step 4: Create `apps/api/src/llm-routes.ts`**

```ts
import { ExtractEventsRequestSchema } from '@carlog/contracts';
import { CarNotFoundError, extractEvents, type CarRepository, type LlmProvider } from '@carlog/domain';
import { ok, type ApiResult } from './errors';
import type { ApiEvent } from './router';

export type ImportDeps = { cars: CarRepository; llm: LlmProvider };

// Handles POST /import/extract?carId=<id> ; returns null if not matched.
// The carId is required (extraction context) and comes from a query-independent path:
// we accept it in the body alongside the text to keep the route flat.
export async function handleImportRoute(
  deps: ImportDeps, event: ApiEvent, ownerId: string,
): Promise<ApiResult | null> {
  const { method, path, body } = event;
  if (path !== '/import/extract' || method !== 'POST') return null;

  const b = (body ?? {}) as { carId?: unknown };
  const carId = typeof b.carId === 'string' ? b.carId : '';
  const car = await deps.cars.getById(ownerId, carId);
  if (!car) throw new CarNotFoundError(carId);

  const { text } = ExtractEventsRequestSchema.parse(body);
  const events = await extractEvents(text, deps.llm, {
    car: { make: car.make, model: car.model, year: car.year },
  });
  return ok(200, { events });
}
```

Note: `ExtractEventsRequestSchema.parse(body)` validates `text` (ignores extra `carId` key — Zod objects strip unknown keys by default). The car ownership check runs first so a bad/foreign carId → 404 before any LLM call. Confirm `car.make`/`car.model`/`car.year` are the actual Car field names (they are, per `packages/contracts/src/car.ts` — `year` is optional).

- [ ] **Step 5: Wire the route + deps in `apps/api/src/router.ts`**

- Extend the domain import to include `LlmProvider`:
  ```ts
  import { CarNotFoundError, createCar, type CarRepository, type PhotoRepository, type PhotoStorage, type EventRepository, type ProofRepository, type LlmProvider } from '@carlog/domain';
  ```
- Add the import-routes import:
  ```ts
  import { handleImportRoute } from './llm-routes';
  ```
- Add `llm` to `RouteDeps`:
  ```ts
  export type RouteDeps = {
    cars: CarRepository; photos: PhotoRepository; storage: PhotoStorage;
    events: EventRepository; proofs: ProofRepository; llm: LlmProvider;
  };
  ```
- Add the route dispatch INSIDE `route`, after the `ownerId` guard and before the photo sub-routes block (it has no `{id}` path param):
  ```ts
    if (path === '/import/extract') {
      const result = await handleImportRoute(deps, event, ownerId);
      if (result) return result;
    }
  ```

- [ ] **Step 6: Add router tests — `apps/api/src/router.test.ts`**

Add the import at the top with the other in-memory imports:

```ts
import { InMemoryLlmProvider } from './in-memory-llm-provider';
import { LlmUnavailableError } from './llm-errors';
```

Add `llm` to the `deps` type annotation and the `beforeEach` construction. Change the `deps` line and the `beforeEach` body to include a default provider (a valid single-event output):

```ts
let deps: { cars: InMemoryCarRepository; photos: InMemoryPhotoRepository; storage: PhotoStorage; events: InMemoryEventRepository; proofs: InMemoryProofRepository; llm: InMemoryLlmProvider };
// ...inside beforeEach:
  deps = {
    cars, photos, storage,
    events: new InMemoryEventRepository(),
    proofs: new InMemoryProofRepository(),
    llm: new InMemoryLlmProvider({ events: [{ date: '2024-01-15', mileage: 45000, cost: 1200, category: 'oil_change' }] }),
  };
```

Add this describe block (helper to create a car first, since the route requires ownership):

```ts
describe('POST /import/extract', () => {
  async function makeCar(ownerId: string): Promise<string> {
    const res = await route(deps, { ...base, method: 'POST', path: '/cars', ownerId, body: validBody });
    return JSON.parse(res.body).id as string;
  }

  it('returns extracted candidate events for the owner car', async () => {
    const carId = await makeCar('u1');
    const res = await route(deps, { ...base, method: 'POST', path: '/import/extract', ownerId: 'u1', body: { carId, text: 'oil change at 45000' } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).events).toHaveLength(1);
  });

  it('404s when the car is not owned by the caller', async () => {
    const carId = await makeCar('u1');
    const res = await route(deps, { ...base, method: 'POST', path: '/import/extract', ownerId: 'u2', body: { carId, text: 'x' } });
    expect(res.statusCode).toBe(404);
  });

  it('400s on empty text', async () => {
    const carId = await makeCar('u1');
    const res = await route(deps, { ...base, method: 'POST', path: '/import/extract', ownerId: 'u1', body: { carId, text: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('503s when the LLM provider is unavailable', async () => {
    const carId = await makeCar('u1');
    deps.llm = new InMemoryLlmProvider(null, new LlmUnavailableError());
    const res = await route(deps, { ...base, method: 'POST', path: '/import/extract', ownerId: 'u1', body: { carId, text: 'x' } });
    expect(res.statusCode).toBe(503);
  });

  it('422s when extraction yields shapeless output twice', async () => {
    const carId = await makeCar('u1');
    deps.llm = new InMemoryLlmProvider('not an array or events object');
    const res = await route(deps, { ...base, method: 'POST', path: '/import/extract', ownerId: 'u1', body: { carId, text: 'x' } });
    expect(res.statusCode).toBe(422);
  });
});
```

Note: `validBody` already exists in this test file (the car create body). Confirm it has `make`/`model`/`year` — it does (`{ make: 'Toyota', model: 'Corolla', year: 2020, ... }`).

- [ ] **Step 7: Run API tests + typecheck**

Run: `pnpm --filter @carlog/api test && pnpm --filter @carlog/api typecheck`
Expected: PASS (existing 23 router/key tests + 5 new import tests).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/llm-errors.ts apps/api/src/in-memory-llm-provider.ts apps/api/src/llm-routes.ts apps/api/src/errors.ts apps/api/src/router.ts apps/api/src/router.test.ts
git commit -m "feat(api): add POST /import/extract route with typed 422/503 errors"
```

---

### Task 4: API — Bedrock LLM adapter + handler wiring

> **REQUIRED:** invoke the `claude-api` skill BEFORE writing any SDK call in this task. It carries the current `AnthropicBedrockMantle` client class, the exact `anthropic.claude-opus-4-8` model id, the adaptive-thinking + `output_config.effort` param shape, and the tool-use / structured-output request shape. The code block below is the INTENT; reconcile every SDK-specific name/param against what the skill reports, and adjust if the skill shows drift. Do NOT invent params from memory.

**Files:**
- Create: `apps/api/src/bedrock-llm-provider.ts`
- Modify: `apps/api/src/handler.ts`, `apps/api/package.json`

**Interfaces:**
- Consumes: `LlmProvider`, `ExtractionContext` from `@carlog/domain`; `LlmUnavailableError` from `./llm-errors` (Task 3).
- Produces: `class BedrockLlmProvider implements LlmProvider` (constructed in `handler.ts`).

- [ ] **Step 1: Add the SDK dependency to `apps/api/package.json`**

Add to `dependencies` (keep alphabetical-ish with the existing `@aws-sdk/*` / `@carlog/*` entries):

```json
"@anthropic-ai/bedrock-sdk": "^0.12.0"
```

Then install: `pnpm install` (repo root). Expected: lockfile updates, no errors. (If the skill reports a newer major, use that version.)

- [ ] **Step 2: Invoke the `claude-api` skill**

Read the skill's current guidance on `AnthropicBedrockMantle` construction, model id, adaptive thinking, and structured output. Note any deviations from the code block in Step 3 and apply them.

- [ ] **Step 3: Create `apps/api/src/bedrock-llm-provider.ts`**

The adapter builds a strongly-worded extraction prompt, calls Claude on Bedrock with a tool/structured-output that forces a `{ events: [...] }` JSON shape, and returns the parsed JSON as `unknown` (the domain use-case validates it). Wrap Bedrock/network failures in `LlmUnavailableError`. INTENT code (reconcile with the skill):

```ts
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import type { LlmProvider, ExtractionContext } from '@carlog/domain';
import { LlmUnavailableError } from './llm-errors';

const MODEL = 'anthropic.claude-opus-4-8';

// The tool schema mirrors the CandidateEvent shape so the model emits committable JSON.
// Kept minimal here; the domain use-case is the authoritative validator.
const EXTRACT_TOOL = {
  name: 'record_events',
  description: 'Return the maintenance events extracted from the text.',
  input_schema: {
    type: 'object',
    properties: {
      events: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD; best estimate if partial' },
            mileage: { type: 'integer', description: 'odometer in km, 0 if unknown' },
            cost: { type: 'number', description: 'total cost, 0 if unknown' },
            currency: { type: 'string', description: 'ISO-ish code, default UAH' },
            category: { type: 'string', enum: ['oil_change', 'tires', 'brakes', 'inspection', 'repair', 'other'] },
            title: { type: 'string' },
            notes: { type: 'string' },
            works: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  parts: { type: 'array', items: { type: 'object' } },
                },
                required: ['description'],
              },
            },
          },
          required: ['date', 'mileage', 'cost', 'category'],
        },
      },
    },
    required: ['events'],
  },
} as const;

function prompt(text: string, ctx: ExtractionContext): string {
  const { make, model, year } = ctx.car;
  return [
    `You extract vehicle maintenance events from free-form text for a ${year ?? ''} ${make} ${model}.`,
    'Return ONLY structured data via the record_events tool. Do not invent events that are not in the text.',
    'Use category "other" when unsure. Use 0 for unknown mileage/cost. Estimate the date as YYYY-MM-DD.',
    '',
    'TEXT:',
    text,
  ].join('\n');
}

export class BedrockLlmProvider implements LlmProvider {
  private readonly client = new AnthropicBedrockMantle({
    // Auth via AWS_BEARER_TOKEN_BEDROCK env (set by CDK from SSM). Region via AWS_REGION.
    awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  });

  async extractEvents(text: string, ctx: ExtractionContext): Promise<unknown> {
    let res;
    try {
      res = await this.client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        tools: [EXTRACT_TOOL],
        tool_choice: { type: 'tool', name: 'record_events' },
        messages: [{ role: 'user', content: prompt(text, ctx) }],
      });
    } catch (err) {
      // Never leak the token; log the class only.
      console.error('Bedrock call failed', (err as Error).name);
      throw new LlmUnavailableError();
    }
    // Pull the tool-use input (the structured JSON) out of the response content.
    const toolUse = res.content.find((c) => c.type === 'tool_use');
    return toolUse && 'input' in toolUse ? toolUse.input : null;
  }
}
```

If the `claude-api` skill shows different construction (e.g. `AnthropicBedrock` vs `AnthropicBedrockMantle`, a different response-content accessor, or that `max_tokens`/`output_config` names differ), APPLY the skill's version — the user's global rule mandates `AnthropicBedrockMantle`, adaptive thinking, and `output_config.effort`, so keep those semantics even if names shift.

- [ ] **Step 4: Wire the adapter into `apps/api/src/handler.ts`**

- Add the import:
  ```ts
  import { BedrockLlmProvider } from './bedrock-llm-provider';
  ```
- Add `llm` to the `deps` object:
  ```ts
  const deps: RouteDeps = {
    cars: new DynamoCarRepository(tableName, client),
    photos: new DynamoPhotoRepository(tableName, client),
    storage: new S3PhotoStorage(photosBucket, new S3Client({})),
    events: new DynamoEventRepository(tableName, client),
    proofs: new DynamoProofRepository(tableName, client),
    llm: new BedrockLlmProvider(),
  };
  ```

- [ ] **Step 5: Typecheck + build the API bundle**

Run: `pnpm --filter @carlog/api typecheck`
Expected: PASS. (The adapter is not unit-tested — it's the integration boundary, verified live in Task 8.)

If typecheck fails on SDK types, that's the signal to re-check the `claude-api` skill output and fix the call shape.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bedrock-llm-provider.ts apps/api/src/handler.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): add AnthropicBedrockMantle adapter for event extraction"
```

---

### Task 5: Infrastructure — extract route, SSM token, timeout

**Files:**
- Modify: `infrastructure/cdk/lib/carlog-stack.ts`

**Interfaces:**
- Consumes: existing `fn` (the `CarsFn` NodejsFunction), `httpApi`, `integration`, `authorizer`, and the `SecretValue` import (already present from the Google-signin merge).

- [ ] **Step 1: Inject the Bedrock token env into the Lambda**

In `carlog-stack.ts`, extend the `fn` (`NodejsFunction`) `environment` map to add the token from SSM. Change:

```ts
      environment: { TABLE_NAME: table.tableName, PHOTOS_BUCKET: photosBucket.bucketName },
```

to:

```ts
      environment: {
        TABLE_NAME: table.tableName,
        PHOTOS_BUCKET: photosBucket.bucketName,
        // Bedrock bearer token from SSM SecureString via a CloudFormation dynamic
        // reference — never in synth output or the repo. Read by AnthropicBedrockMantle.
        AWS_BEARER_TOKEN_BEDROCK: SecretValue.ssmSecure('/carlog/bedrock-bearer-token').unsafeUnwrap(),
      },
```

- [ ] **Step 2: Bump the Lambda timeout for the LLM round-trip**

Change:

```ts
      timeout: Duration.seconds(10),
```

to:

```ts
      // 29s: the extract route makes a Bedrock call that can take 10-20s; other routes
      // are fast. 29s stays under the API Gateway HTTP API 30s integration hard cap.
      timeout: Duration.seconds(29),
```

- [ ] **Step 3: Add the extract route**

After the existing `httpApi.addRoutes(...)` lines (the last one is the proofs `{proofId}` DELETE), add:

```ts
    httpApi.addRoutes({ path: '/import/extract', methods: [HttpMethod.POST], integration, authorizer });
```

- [ ] **Step 4: Synth and confirm the token is NOT in the output**

Run:
```bash
AWS_PROFILE=yevhenii CDK_DEFAULT_REGION=us-east-1 pnpm --filter @carlog/cdk synth > /tmp/carlog-synth.txt
grep -c 'ssm-secure:/carlog/bedrock-bearer-token' /tmp/carlog-synth.txt   # expect >= 1 (dynamic ref present)
grep -c 'import/extract' /tmp/carlog-synth.txt                            # expect >= 1 (route present)
```
Expected: synth exits 0; the `ssm-secure` dynamic reference is present (the literal token value is never resolved at synth time); the route is present.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @carlog/cdk typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/cdk/lib/carlog-stack.ts
git commit -m "feat(cdk): add /import/extract route, inject Bedrock token from SSM, raise timeout to 29s"
```

---

### Task 6: Web — api-client, query mutation, i18n namespace

**Files:**
- Modify: `apps/web/src/api-client.ts`, `apps/web/src/queries.ts`, `apps/web/src/i18n/index.ts`
- Create: `apps/web/src/i18n/locales/en/import.json`, `apps/web/src/i18n/locales/uk/import.json`

**Interfaces:**
- Consumes: `ExtractEventsResponseSchema`, type `ExtractEventsResponse`, type `CandidateEvent` from `@carlog/contracts` (Task 1); the existing `request` wrapper + `useAuth` token pattern.
- Produces:
  - `extractEvents(token, carId, text): Promise<ExtractEventsResponse>` in api-client
  - `useExtractEvents(carId)` mutation in queries

- [ ] **Step 1: Add `extractEvents` to `apps/web/src/api-client.ts`**

Add `ExtractEventsResponseSchema` to the `@carlog/contracts` import at the top of the file, then add the function near the other event functions:

```ts
export const extractEvents = (token: string, carId: string, text: string): Promise<ExtractEventsResponse> =>
  request(token, '/import/extract', ExtractEventsResponseSchema, { method: 'POST', body: JSON.stringify({ carId, text }) });
```

Also add `import type { ExtractEventsResponse } from '@carlog/contracts';` if types are imported separately in this file (match the file's existing import style — it imports types alongside schemas).

- [ ] **Step 2: Add `useExtractEvents` to `apps/web/src/queries.ts`**

Add `extractEvents` to the api-client import at the top, then add near `useCreateEvent`:

```ts
export function useExtractEvents(carId: string) {
  const token = useToken();
  return useMutation({ mutationFn: (text: string) => extractEvents(token, carId, text) });
}
```

Confirm the token-accessor helper name used by the other hooks in this file (it may be `useToken()` or an inline `useAuth().accessToken`). Match whatever `useCreateEvent` uses. No `onSuccess` invalidation here — this mutation only reads; the timeline refresh happens when the dialog commits via `useCreateEvent`.

- [ ] **Step 3: Create `apps/web/src/i18n/locales/en/import.json`**

```json
{
  "title": "Import from text",
  "trigger": "Import from text",
  "instructions": "Paste your maintenance notes, an old logbook, or a mechanic's invoice. We'll extract the events for you to review before adding them.",
  "textLabel": "Paste text",
  "extract": "Extract events",
  "extracting": "Reading your text…",
  "reviewTitle": "Review {{count}} event",
  "reviewTitle_other": "Review {{count}} events",
  "empty": "No events found in that text. Try adding more detail.",
  "addAll": "Add {{count}} event",
  "addAll_other": "Add {{count}} events",
  "adding": "Adding…",
  "remove": "Remove",
  "cancel": "Cancel",
  "errorFailed": "We couldn't read events from that text. Try rephrasing or adding detail.",
  "errorUnavailable": "The AI service is busy right now. Please try again in a moment.",
  "added": "Added {{count}} event to the timeline",
  "added_other": "Added {{count}} events to the timeline"
}
```

- [ ] **Step 4: Create `apps/web/src/i18n/locales/uk/import.json`**

```json
{
  "title": "Імпорт із тексту",
  "trigger": "Імпорт із тексту",
  "instructions": "Вставте свої нотатки про обслуговування, стару сервісну книжку або рахунок від механіка. Ми виділимо події для перегляду перед додаванням.",
  "textLabel": "Вставте текст",
  "extract": "Виділити події",
  "extracting": "Читаємо ваш текст…",
  "reviewTitle": "Перегляд {{count}} події",
  "reviewTitle_other": "Перегляд {{count}} подій",
  "empty": "У цьому тексті не знайдено подій. Спробуйте додати деталі.",
  "addAll": "Додати {{count}} подію",
  "addAll_other": "Додати {{count}} подій",
  "adding": "Додавання…",
  "remove": "Видалити",
  "cancel": "Скасувати",
  "errorFailed": "Не вдалося виділити події з цього тексту. Спробуйте переформулювати або додати деталі.",
  "errorUnavailable": "AI-сервіс зараз зайнятий. Спробуйте ще раз за мить.",
  "added": "Додано {{count}} подію до історії",
  "added_other": "Додано {{count}} подій до історії"
}
```

- [ ] **Step 5: Register the `import` namespace in `apps/web/src/i18n/index.ts`**

- Add the two imports alongside the existing locale imports:
  ```ts
  import enImport from './locales/en/import.json';
  import ukImport from './locales/uk/import.json';
  ```
- Add `'import'` to the `ns` array:
  ```ts
  ns: ['common', 'garage', 'vehicle', 'car', 'photos', 'auth', 'event', 'import'],
  ```
- Add `import:` to both resource maps:
  ```ts
  en: { common: enCommon, garage: enGarage, vehicle: enVehicle, car: enCar, photos: enPhotos, auth: enAuth, event: enEvent, import: enImport },
  uk: { common: ukCommon, garage: ukGarage, vehicle: ukVehicle, car: ukCar, photos: ukPhotos, auth: ukAuth, event: ukEvent, import: ukImport },
  ```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @carlog/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api-client.ts apps/web/src/queries.ts apps/web/src/i18n/index.ts apps/web/src/i18n/locales/en/import.json apps/web/src/i18n/locales/uk/import.json
git commit -m "feat(web): add extractEvents client, useExtractEvents hook, import i18n namespace"
```

---

### Task 7: Web — ImportEventsDialog + Vehicle screen trigger

**Files:**
- Create: `apps/web/src/components/ImportEventsDialog.tsx`
- Modify: `apps/web/src/routes/Vehicle.tsx`

**Interfaces:**
- Consumes: `useExtractEvents` (Task 6), `useCreateEvent` (existing) from `../queries`; type `CandidateEvent` from `@carlog/contracts`; the `import` namespace (Task 6).
- Produces: `ImportEventsDialog({ carId, open, onClose })` component; a trigger button on the Vehicle screen.

- [ ] **Step 1: Create `apps/web/src/components/ImportEventsDialog.tsx`**

Three phases in one dialog: (a) paste + Extract, (b) editable review list, (c) commit. Editing is intentionally minimal for v1 — each candidate is an editable text summary of the key fields (date, mileage, cost, category, title) plus a Remove button; committing POSTs each via `useCreateEvent`. Keeping the review lightweight (not a full EventFormDialog per card) is deliberate YAGNI — the user can fine-tune any event with the normal edit flow after import.

```tsx
import { useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import { EVENT_CATEGORIES, type CandidateEvent } from '@carlog/contracts';
import { useExtractEvents, useCreateEvent } from '../queries';

type Phase = 'input' | 'review';

export function ImportEventsDialog({ carId, open, onClose }: { carId: string; open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['import', 'event', 'common']);
  const extract = useExtractEvents(carId);
  const create = useCreateEvent(carId);
  const [phase, setPhase] = useState<Phase>('input');
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<CandidateEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);

  const reset = () => { setPhase('input'); setText(''); setDrafts([]); setError(null); setCommitting(false); };
  const close = () => { reset(); onClose(); };

  const onExtract = async () => {
    setError(null);
    try {
      const res = await extract.mutateAsync(text);
      setDrafts(res.events);
      setPhase('review');
    } catch (e) {
      const status = (e as Error).message;
      setError(status.includes('503') ? t('import:errorUnavailable') : t('import:errorFailed'));
    }
  };

  const patch = (i: number, p: Partial<CandidateEvent>) =>
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...p } : d)));
  const remove = (i: number) => setDrafts((prev) => prev.filter((_, idx) => idx !== i));

  const onCommit = async () => {
    setCommitting(true);
    setError(null);
    try {
      for (const d of drafts) { await create.mutateAsync(d); }
      close();
    } catch {
      setError(t('import:errorFailed'));
      setCommitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>{t('import:title')}</DialogTitle>
      <DialogContent>
        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        {phase === 'input' ? (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">{t('import:instructions')}</Typography>
            <TextField
              label={t('import:textLabel')} value={text} onChange={(e) => setText(e.target.value)}
              multiline minRows={6} fullWidth inputProps={{ maxLength: 10000 }}
            />
          </Stack>
        ) : drafts.length === 0 ? (
          <Typography color="text.secondary" sx={{ mt: 1 }}>{t('import:empty')}</Typography>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="subtitle2">{t('import:reviewTitle', { count: drafts.length })}</Typography>
            {drafts.map((d, i) => (
              <Box key={i} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
                <Stack direction="row" justifyContent="flex-end">
                  <IconButton size="small" aria-label={t('import:remove')} onClick={() => remove(i)}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
                <Stack spacing={1.5}>
                  <TextField label={t('event:category')} select size="small" value={d.category}
                    onChange={(e) => patch(i, { category: e.target.value as CandidateEvent['category'] })} fullWidth>
                    {EVENT_CATEGORIES.map((c) => <MenuItem key={c} value={c}>{t(`event:categories.${c}`)}</MenuItem>)}
                  </TextField>
                  <Stack direction="row" spacing={1.5}>
                    <TextField label={t('event:date')} type="date" size="small" value={d.date}
                      onChange={(e) => patch(i, { date: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
                    <TextField label={t('event:mileage')} type="number" size="small" value={d.mileage}
                      onChange={(e) => patch(i, { mileage: Number(e.target.value) })} fullWidth />
                  </Stack>
                  <Stack direction="row" spacing={1.5}>
                    <TextField label={t('event:cost')} type="number" size="small" value={d.cost}
                      onChange={(e) => patch(i, { cost: Number(e.target.value) })} fullWidth />
                    <TextField label={t('event:title')} size="small" value={d.title ?? ''}
                      onChange={(e) => patch(i, { title: e.target.value })} fullWidth />
                  </Stack>
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t('import:cancel')}</Button>
        {phase === 'input' ? (
          <Button variant="contained" onClick={() => void onExtract()} disabled={!text.trim() || extract.isPending}>
            {extract.isPending ? t('import:extracting') : t('import:extract')}
          </Button>
        ) : (
          <Button variant="contained" onClick={() => void onCommit()} disabled={drafts.length === 0 || committing}>
            {committing ? t('import:adding') : t('import:addAll', { count: drafts.length })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
```

Note: reconcile the `event:` string keys (`category`, `date`, `mileage`, `cost`, `title`, `categories.<c>`) against the ACTUAL keys in `apps/web/src/i18n/locales/en/event.json` — use the exact keys the existing EventFormDialog uses. If a category-label key path differs (e.g. `event:category_oil_change` vs `event:categories.oil_change`), match the existing convention.

- [ ] **Step 2: Add the trigger to `apps/web/src/routes/Vehicle.tsx`**

- Add imports:
  ```ts
  import { ImportEventsDialog } from '../components/ImportEventsDialog';
  ```
  (and ensure `useTranslation` includes the `import` namespace where used, or use a second `t` — simplest: the button label uses `t('import:trigger')`, so add `'import'` to the component's `useTranslation([...])` array).
- Add state near the other dialog state:
  ```ts
  const [importOpen, setImportOpen] = useState(false);
  ```
- Render a button just above `<ServiceTimeline carId={car.id} />` (line ~62), plus the dialog:
  ```tsx
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
          <Button variant="outlined" onClick={() => setImportOpen(true)}>{t('import:trigger')}</Button>
        </Stack>
        <ServiceTimeline carId={car.id} />
        <ImportEventsDialog carId={car.id} open={importOpen} onClose={() => setImportOpen(false)} />
  ```
  Confirm `useState` is already imported (it is) and add `'import'` to the `useTranslation` namespaces array on this screen.

- [ ] **Step 3: Typecheck + lint + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build`
Expected: all PASS. Then SW guard: `grep -c execute-api apps/web/dist/sw.js` → `0`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ImportEventsDialog.tsx apps/web/src/routes/Vehicle.tsx
git commit -m "feat(web): add AI import dialog and Vehicle-screen trigger"
```

---

### Task 8: Verify + deploy

**Files:** none (deploy + live verification only).

**Prerequisites (USER manual steps — blocking; confirm done before deploying):**
1. Bedrock API key created and stored:
   `aws ssm put-parameter --profile yevhenii --region us-east-1 --name /carlog/bedrock-bearer-token --type SecureString --value '<token>'`
2. Bedrock model access for `anthropic.claude-opus-4-8` enabled in us-east-1 for account 898836755334 (Bedrock console → Model access).

- [ ] **Step 1: Full gate suite on the branch**

Run: `pnpm turbo run typecheck lint test`
Expected: all packages green (contracts + domain + api new tests; web typecheck/lint).

- [ ] **Step 2: Deploy backend (routes + Lambda + token env)**

Run:
```bash
AWS_PROFILE=yevhenii CDK_DEFAULT_REGION=us-east-1 pnpm --filter @carlog/cdk exec cdk deploy --require-approval never
```
Expected: `CarLogStack` updates successfully (new route + Lambda env + timeout). If it rolls back, read the CloudFormation events before retrying (do NOT add `reservedConcurrentExecutions`).

- [ ] **Step 3: Deploy web**

Run: `AWS_PROFILE=yevhenii ./scripts/deploy-web.sh`
Expected: build + S3 sync + CloudFront invalidate; ends with "Deployed web to <WebUrl>".

- [ ] **Step 4: Live smoke test (report actual results)**

1. Open a car → click "Import from text" → paste a multi-entry sample (e.g. "Oil change Jan 2024 at 45000km, 1200 UAH. New front brake pads March 2024, 60000km, 3000 UAH.") → Extract.
2. Confirm candidate events appear with plausible fields; edit one, remove one.
3. "Add N events" → confirm they appear on the timeline (created via the existing route).
4. Paste empty text → Extract disabled; paste gibberish → 422 message shown, pasted text preserved.
5. Toggle EN⇄UK → dialog strings translate.
6. Confirm the bearer token does NOT appear in the deployed web bundle:
   `curl -s <WebUrl>/assets/*.js` (spot check) — token must be absent (it's server-side only).

- [ ] **Step 5: Finish the branch**

Use superpowers:finishing-a-development-branch to merge (tests must pass first).

---

## Self-Review Notes

- **Spec coverage:** architecture/boundaries → T1 (contracts), T2 (domain port+use-case), T3+T4 (api adapter+route); extract-only write flow → T3 route returns candidates, T7 dialog commits via existing `useCreateEvent`; data flow → T3/T6/T7; contract shapes → T1 (`CandidateEvent = CreateEventSchema`); provider port → T2; error handling (400/422/503/500) → T2 (`ExtractionFailedError`), T3 (mapping + `LlmUnavailableError`), T4 (adapter wraps failures); cost guardrails (10k/50/adaptive-thinking/tool-use/timeout) → T1 bounds, T4 params, T5 timeout; testing → T1/T2/T3 unit tests, T4 adapter deferred to live, T8 smoke; SSM token prereq → T5 + T8 prereq; verification DoD → T8. All spec sections mapped.
- **Placeholder scan:** no TBD/TODO. Task 4's SDK code is explicitly marked INTENT-to-reconcile-with-`claude-api`-skill (required, not a placeholder). The `event:` key reconciliation notes in T7 are verify-against-existing instructions, not gaps.
- **Type consistency:** `CandidateEvent`/`CandidateEventSchema` (T1) used by T2 use-case, T3 fake output, T6 client, T7 dialog. `LlmProvider`/`ExtractionContext` (T2) implemented by T3 fake + T4 adapter, consumed by T3 route. `ExtractionFailedError` (T2, domain) mapped in T3 errors. `LlmUnavailableError` (T3, api) thrown by T4 adapter, mapped in T3 errors. `extractEvents(text, provider, ctx)` signature consistent T2↔T3. `RouteDeps.llm` added T3, populated T4 handler + T3 tests. `useExtractEvents(carId)` (T6) consumed by T7. `ExtractEventsResponseSchema` (T1) used by T6 client. Consistent throughout.
- **Ordering safety:** each task's gates pass on its own (T4's route is reachable only after T3 wires it, but T3's tests use the in-memory fake, so T3 is green independently; T4 typecheck covers the adapter). T5 (CDK) and T6/T7 (web) are independent of each other.
