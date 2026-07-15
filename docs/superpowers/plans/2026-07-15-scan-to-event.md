# Add Event by Invoice Photo (Scan-to-Event) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photograph/upload an invoice (image or PDF) on the vehicle screen → Claude vision extracts one or more candidate events → user reviews/edits → commit → the scanned document is attached as a proof to each created event via a server-side S3 copy (single upload).

**Architecture:** One browser upload to a `scans/<owner>/` scratch key; a sync `POST /import/scan` has the Lambda read that object, base64 it, and call a new vision provider method that returns `CandidateEvent[]` (reusing the import review UI + validation). On commit, each event is created via the existing route, then a `from-scan` proof-confirm server-side `CopyObject`s the scan into the event's proof key. Cost `0` renders blank everywhere.

**Tech Stack:** TypeScript strict, Zod, `@anthropic-ai/bedrock-sdk` (vision), `@aws-sdk/client-s3` (CopyObject), AWS CDK, React 18 + MUI + TanStack Query + react-i18next, Vitest.

## Global Constraints

- **Caps/enums (verbatim):** `SCAN_DOC_CONTENT_TYPES = ['image/jpeg','image/png','image/webp','image/heic','application/pdf']`; `MAX_SCAN_SIZE = 10_485_760`. Reuse `CandidateEventSchema` (partial-tolerant) and `ExtractEventsResponseSchema` `{events: CandidateEvent[]}` for the scan response.
- **Naming:** NO "invoice" in code — endpoint `POST /import/scan`, `POST /import/scan/presign`; provider method + use-case `extractEventsFromDocument`; S3 prefix `scans/`; proof variant `from-scan`. "Invoice" only in user-facing i18n.
- **Clean architecture:** `packages/domain` stays AWS-free — port method + pure use-case only; the vision adapter + S3 copy live in `apps/api`. `extractEvents` (text) and `BedrockLlmProvider`'s existing method stay behaviorally UNCHANGED; refactor only the shared validation helper.
- **Byte path:** presign → PUT to `scans/<ownerId>/<uuid>` → Lambda `GetObject` → base64 → Claude. NOT inline base64.
- **Auto-attach:** on commit, per created event, server-side `CopyObject scans/<...> → proofs/<owner>/<carId>/<eventId>/<proofId>` + register a proof row. No re-upload. Never roll back a created event if attach fails.
- **Unknown cost:** when `cost === 0`, the review card AND the timeline `EventCard` render NO amount (blank / "—"), never "0 UAH". Data stays `cost: 0`.
- **Security:** ownership 404 before extraction; `s3Key` must start with `scans/<ownerId>/` (400 IDOR guard) on both `POST /import/scan` and the `from-scan` proof confirm.
- **`claude-api` skill:** the task implementing the Bedrock vision method MUST invoke it first to confirm the image/document content-block shape — do not write vision SDK calls from memory.
- Strict TS, never `any`; MUI only; extensionless imports; strings via `t()` EN+UK; conventional commits; NEVER any co-authorship trailer. Do NOT set `reservedConcurrentExecutions`. AWS profile `yevhenii`, us-east-1. SW guard after web build: `grep -c execute-api apps/web/dist/sw.js` = 0.

## File Structure

```
packages/contracts/src/import.ts                CREATE-additions  scan schemas + FromScanProofSchema (T1)
packages/contracts/src/import.test.ts            MODIFY  schema tests (T1)
packages/domain/src/llm-provider.ts              MODIFY  extractEventsFromDocument port method (T2)
packages/domain/src/extract-events.ts            MODIFY  shared validate helper + document use-case (T2)
packages/domain/src/extract-events.test.ts       MODIFY  document use-case tests (T2)
apps/api/src/bedrock-llm-provider.ts             MODIFY  vision method (T3, claude-api skill first)
apps/api/src/in-memory-llm-provider.ts           MODIFY  fake extractEventsFromDocument (T3)
packages/domain/src/photo-repository.ts          MODIFY  add copyObject to PhotoStorage port (T4)
apps/api/src/s3-photo-storage.ts                 MODIFY  copyObject impl (T4)
apps/api/src/event-routes.ts                     MODIFY  from-scan proof confirm (T4)
apps/api/src/scan-routes.ts                       CREATE  presign + POST /import/scan (T5)
apps/api/src/router.ts                           MODIFY  wire scan routes + storage.copyObject in fakes (T5)
apps/api/src/router.test.ts                      MODIFY  scan + from-scan tests (T5)
apps/api/src/handler.ts                          MODIFY  loadScanBase64 loader into scan deps (T5)
infrastructure/cdk/lib/carlog-stack.ts           MODIFY  scan routes + scans/ lifecycle (T6)
apps/web/src/lib/format-cost.ts (+test)          CREATE  cost-or-blank helper (T7)
apps/web/src/components/EventCard.tsx            MODIFY  hide cost when 0 (T7)
apps/web/src/api-client.ts                       MODIFY  presignScan/extractFromScan/confirmProofFromScan (T8)
apps/web/src/queries.ts                          MODIFY  useExtractFromScan (T8)
apps/web/src/components/ScanInvoiceDialog.tsx    CREATE  scan trigger + review + attach loop (T9)
apps/web/src/routes/Vehicle.tsx                  MODIFY  "Scan invoice" trigger (T9)
apps/web/src/i18n/locales/{en,uk}/{import,event}.json  MODIFY  scan keys (T8/T9)
```

Order: contracts (1) → domain (2) → adapter+fake (3) → storage copy + from-scan proof (4) → scan routes+wiring (5) → CDK (6) → cost-display fix (7) → web client (8) → web dialog+trigger (9) → deploy+verify (10).

---

### Task 1: Contracts — scan schemas + from-scan proof request

**Files:** Modify `packages/contracts/src/import.ts`, `packages/contracts/src/import.test.ts`

**Interfaces produced:** `SCAN_DOC_CONTENT_TYPES`, `ScanDocContentTypeSchema`/`ScanDocContentType`, `MAX_SCAN_SIZE`, `ScanPresignRequestSchema`/`ScanPresignRequest`, `ScanPresignResponseSchema`, `ExtractFromScanRequestSchema`/`ExtractFromScanRequest`, `FromScanProofSchema`/`FromScanProof`. Response reuses existing `ExtractEventsResponseSchema`.

- [ ] **Step 1: Failing tests (append to `import.test.ts`)**

```ts
import {
  ScanPresignRequestSchema, ExtractFromScanRequestSchema, FromScanProofSchema, MAX_SCAN_SIZE,
} from './import';

describe('scan schemas', () => {
  const carId = '3f1e9d5a-6b2c-4e8f-9a1b-2c3d4e5f6a7b';
  it('accepts a jpeg presign under the cap', () => {
    expect(ScanPresignRequestSchema.safeParse({ contentType: 'image/jpeg', size: 1000 }).success).toBe(true);
  });
  it('accepts a pdf', () => {
    expect(ScanPresignRequestSchema.safeParse({ contentType: 'application/pdf', size: 1000 }).success).toBe(true);
  });
  it('rejects an unsupported content type', () => {
    expect(ScanPresignRequestSchema.safeParse({ contentType: 'image/gif', size: 1000 }).success).toBe(false);
  });
  it('rejects over the size cap', () => {
    expect(ScanPresignRequestSchema.safeParse({ contentType: 'image/png', size: MAX_SCAN_SIZE + 1 }).success).toBe(false);
  });
  it('validates an extract-from-scan request', () => {
    expect(ExtractFromScanRequestSchema.safeParse({ carId, s3Key: 'scans/u/x.jpg', contentType: 'image/jpeg' }).success).toBe(true);
  });
  it('validates a from-scan proof request', () => {
    expect(FromScanProofSchema.safeParse({ s3Key: 'scans/u/x.jpg', contentType: 'image/jpeg', size: 5000 }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run — FAIL** (`pnpm --filter @carlog/contracts test`).

- [ ] **Step 3: Append to `import.ts`**

```ts
export const SCAN_DOC_CONTENT_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
] as const;
export const ScanDocContentTypeSchema = z.enum(SCAN_DOC_CONTENT_TYPES);
export type ScanDocContentType = z.infer<typeof ScanDocContentTypeSchema>;
export const MAX_SCAN_SIZE = 10_485_760;

export const ScanPresignRequestSchema = z.object({
  contentType: ScanDocContentTypeSchema,
  size: z.number().int().min(1).max(MAX_SCAN_SIZE),
});
export type ScanPresignRequest = z.infer<typeof ScanPresignRequestSchema>;

export const ScanPresignResponseSchema = z.object({
  key: z.string().min(1), uploadUrl: z.string().url(),
});

export const ExtractFromScanRequestSchema = z.object({
  carId: z.string().uuid(),
  s3Key: z.string().min(1),
  contentType: ScanDocContentTypeSchema,
});
export type ExtractFromScanRequest = z.infer<typeof ExtractFromScanRequestSchema>;

export const FromScanProofSchema = z.object({
  s3Key: z.string().min(1),
  contentType: ScanDocContentTypeSchema,
  // The client holds the picked File, so it sends the byte size — the Proof row requires
  // size >= 1 and the server-side CopyObject doesn't re-measure it.
  size: z.number().int().min(1).max(MAX_SCAN_SIZE),
});
export type FromScanProof = z.infer<typeof FromScanProofSchema>;
```

- [ ] **Step 4: Run tests + typecheck — PASS.**
- [ ] **Step 5: Commit** — `git add packages/contracts/src/import.ts packages/contracts/src/import.test.ts && git commit -m "feat(contracts): add scan-to-event schemas"`

---

### Task 2: Domain — vision port method + document use-case (shared validation)

**Files:** Modify `packages/domain/src/llm-provider.ts`, `packages/domain/src/extract-events.ts`, `packages/domain/src/extract-events.test.ts`

**Interfaces produced:** port method `extractEventsFromDocument(base64: string, mediaType: string, ctx: ExtractionContext): Promise<unknown>`; use-case `extractEventsFromDocument(base64, mediaType, provider, ctx): Promise<CandidateEvent[]>`. Consumes existing `validate`/retry logic (refactored into a shared internal helper).

- [ ] **Step 1: Add the port method** to `packages/domain/src/llm-provider.ts`:

```ts
export interface LlmProvider {
  extractEvents(text: string, ctx: ExtractionContext): Promise<unknown>;
  // Vision: read a maintenance document (image or PDF) and return raw structured output.
  extractEventsFromDocument(base64: string, mediaType: string, ctx: ExtractionContext): Promise<unknown>;
}
```

- [ ] **Step 2: Failing test (append to `extract-events.test.ts`)**

```ts
import { extractEventsFromDocument } from './extract-events';

const docProvider = (...outputs: unknown[]): LlmProvider => {
  const fn = vi.fn();
  outputs.forEach((o) => fn.mockResolvedValueOnce(o));
  // extractEvents unused in these tests but required by the interface
  return { extractEvents: vi.fn(), extractEventsFromDocument: fn };
};

describe('extractEventsFromDocument', () => {
  it('returns multiple candidates from one document', async () => {
    const out = await extractEventsFromDocument('BASE64', 'image/jpeg', docProvider({ events: [valid, { ...valid, category: 'repair' }] }), ctx);
    expect(out).toHaveLength(2);
  });
  it('returns [] when the document is unreadable (no events)', async () => {
    const out = await extractEventsFromDocument('BASE64', 'application/pdf', docProvider({ events: [] }), ctx);
    expect(out).toEqual([]);
  });
  it('drops malformed items', async () => {
    const out = await extractEventsFromDocument('BASE64', 'image/png', docProvider({ events: [valid, { junk: 1 }] }), ctx);
    expect(out).toHaveLength(1);
  });
  it('retries once on shapeless then throws ExtractionFailedError', async () => {
    const p = docProvider('garbage', 'still garbage');
    await expect(extractEventsFromDocument('B', 'image/jpeg', p, ctx)).rejects.toBeInstanceOf(ExtractionFailedError);
    expect(p.extractEventsFromDocument).toHaveBeenCalledTimes(2);
  });
});
```

(`valid`, `ctx`, `ExtractionFailedError` already imported/defined at the top of this test file.)

- [ ] **Step 3: Run — FAIL.**

- [ ] **Step 4: Refactor + implement in `extract-events.ts`**

Extract the existing retry-and-validate flow of `extractEvents` into a shared helper, then add the document use-case. The current `extractEvents` calls `validate(await provider.extractEvents(...))` twice; generalize the "call → validate → retry once → throw" over a thunk:

```ts
// Shared: run a provider call, validate, retry ONCE on shapeless output, else throw.
async function runWithRetry(call: () => Promise<unknown>): Promise<CandidateEvent[]> {
  const first = validate(await call());
  if (first !== null) return first;
  const second = validate(await call());
  if (second !== null) return second;
  throw new ExtractionFailedError();
}

export async function extractEvents(text: string, provider: LlmProvider, ctx: ExtractionContext): Promise<CandidateEvent[]> {
  return runWithRetry(() => provider.extractEvents(text, ctx));
}

export async function extractEventsFromDocument(
  base64: string, mediaType: string, provider: LlmProvider, ctx: ExtractionContext,
): Promise<CandidateEvent[]> {
  return runWithRetry(() => provider.extractEventsFromDocument(base64, mediaType, ctx));
}
```

Keep `validate`, `extractArray`, `MAX_EVENTS`, `ExtractionFailedError` exactly as they are. Export `extractEventsFromDocument` from `packages/domain/src/index.ts`.

- [ ] **Step 5: Run domain tests + typecheck — PASS** (existing extractEvents tests still green — same behavior via the helper).
- [ ] **Step 6: Commit** — `git commit -m "feat(domain): add extractEventsFromDocument use-case (shared retry helper)"`

---

### Task 3: API — Bedrock vision method + fake

> **REQUIRED:** invoke the `claude-api` skill BEFORE writing the vision SDK call to confirm the image/document content-block shape for `AnthropicBedrockMantle`.

**Files:** Modify `apps/api/src/bedrock-llm-provider.ts`, `apps/api/src/in-memory-llm-provider.ts`

- [ ] **Step 1: Invoke `claude-api` skill** — confirm the message `content` shape for a base64 image block and a base64 PDF document block, and the existing tool-use response parse still applies.

- [ ] **Step 2: Add `extractEventsFromDocument` to `bedrock-llm-provider.ts`**

Reuse `MODEL`, `EXTRACT_TOOL`, the `output_config`/thinking config, and the tool-use `.input` extraction already in the file. New method (INTENT — reconcile block shape with the skill):

```ts
async extractEventsFromDocument(base64: string, mediaType: string, ctx: ExtractionContext): Promise<unknown> {
  const docBlock = mediaType === 'application/pdf'
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data: base64 } };
  const promptText = [
    `Read this vehicle maintenance invoice/receipt for a ${ctx.car.year ?? ''} ${ctx.car.make} ${ctx.car.model}.`.trim(),
    'It may list MULTIPLE distinct services (e.g. an oil change AND a repair) — return ONE event per service via the record_events tool.',
    'Omit any field the document does not state (do not guess date/mileage/cost).',
  ].join('\n');
  let res;
  try {
    res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: 'record_events' },
      messages: [{ role: 'user', content: [docBlock, { type: 'text', text: promptText }] }],
    });
  } catch (err) {
    const e = err as Error;
    console.error('Bedrock vision call failed', e.name, e.message);
    throw new LlmUnavailableError();
  }
  const toolUse = res.content.find((c: { type: string }) => c.type === 'tool_use');
  return toolUse && 'input' in toolUse ? toolUse.input : null;
}
```

If the skill shows a different block shape (e.g. document blocks unsupported on the Mantle client, or a different `source` key), APPLY the skill's version and note it in the report.

- [ ] **Step 3: Add the method to the in-memory fake** — `in-memory-llm-provider.ts` currently returns a fixed output for `extractEvents`. Add `async extractEventsFromDocument(): Promise<unknown> { if (this.throwErr) throw this.throwErr; return this.output; }` (same fixed-output behavior; ignores args like the existing method).

- [ ] **Step 4: Gate** — `pnpm --filter @carlog/api typecheck && pnpm --filter @carlog/api lint && pnpm --filter @carlog/api test` (all existing tests still pass; adapter not unit-tested).
- [ ] **Step 5: Commit** — `git commit -m "feat(api): add Bedrock vision extractEventsFromDocument + fake"`

---

### Task 4: API — storage CopyObject + from-scan proof confirm

**Files:** Modify `packages/domain/src/photo-repository.ts`, `apps/api/src/s3-photo-storage.ts`, `apps/api/src/event-routes.ts`

**Interfaces produced:** `PhotoStorage.copyObject(srcKey: string, destKey: string): Promise<void>`; a new proof sub-route `POST /cars/{carId}/events/{eventId}/proofs/from-scan`.

- [ ] **Step 1: Add `copyObject` to the port** (`packages/domain/src/photo-repository.ts`):

```ts
export interface PhotoStorage {
  presignPut(key: string, contentType: string, maxSize: number): Promise<string>;
  presignGet(key: string): Promise<string>;
  deleteObject(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  copyObject(srcKey: string, destKey: string): Promise<void>;
}
```

- [ ] **Step 2: Implement in `s3-photo-storage.ts`** — add `CopyObjectCommand` to the import and:

```ts
async copyObject(srcKey: string, destKey: string): Promise<void> {
  await this.client.send(new CopyObjectCommand({
    Bucket: this.bucket, CopySource: `${this.bucket}/${srcKey}`, Key: destKey,
  }));
}
```

- [ ] **Step 3: Add the from-scan proof route** in `event-routes.ts`, inside the proof sub-routes block (after the existing `POST ${pbase}` confirm), so `pbase = /cars/{carId}/events/{eventId}/proofs`:

```ts
if (path === `${pbase}/from-scan` && method === 'POST') {
  const req = FromScanProofSchema.parse(body);
  if (!req.s3Key.startsWith(`scans/${ownerId}/`)) return ok(400, { error: 'ValidationError', message: 'invalid s3Key' });
  const existing = await deps.proofs.listByEvent(ownerId, carId, eventId);
  assertProofUnderCap(existing.length);
  if (!(await deps.storage.exists(req.s3Key))) throw new ProofNotFoundError('scan');
  const newProofId = crypto.randomUUID();
  const destKey = proofKey(ownerId, carId, eventId, newProofId);
  await deps.storage.copyObject(req.s3Key, destKey);
  const proof = {
    id: newProofId, eventId, carId, ownerId,
    contentType: req.contentType, size: req.size, filename: undefined,
    createdAt: new Date().toISOString(),
  };
  return ok(201, await deps.proofs.create(proof));
}
```

Import `FromScanProofSchema` from `@carlog/contracts`. `size` comes from the client's
`FromScanProof` (the picked File's byte size) because the `Proof` schema requires
`size >= 1` (confirmed in `packages/contracts/src/proof.ts`) and the server-side
`CopyObject` doesn't re-measure the object — this keeps the `Proof` contract unchanged.

- [ ] **Step 4: Update the in-memory storage fake** used in `router.test.ts` to implement `copyObject` (record src→dest; make `exists` return true for `scans/` keys in the relevant test). The fake is defined inline in `router.test.ts` — add `copyObject: async () => {}` (or a spy) there.

- [ ] **Step 5: Gate** — `pnpm --filter @carlog/api typecheck && pnpm --filter @carlog/api lint && pnpm --filter @carlog/api test`.
- [ ] **Step 6: Commit** — `git commit -m "feat(api): add S3 copyObject and from-scan proof confirm route"`

---

### Task 5: API — scan routes + router wiring + handler loader

**Files:** Create `apps/api/src/scan-routes.ts`; modify `apps/api/src/router.ts`, `apps/api/src/router.test.ts`, `apps/api/src/handler.ts`

**Interfaces produced:** `handleScanRoute(deps, event, ownerId)` handling `POST /import/scan/presign` and `POST /import/scan`; `RouteDeps` unchanged if scan uses existing `cars`/`storage`/`llm` + a new `loadScanBase64` dep. Add `loadScanBase64: (key: string) => Promise<{ base64: string } | null>` and `newId` (already present) to `RouteDeps`.

- [ ] **Step 1: Create `scan-routes.ts`**

```ts
import { ScanPresignRequestSchema, ExtractFromScanRequestSchema } from '@carlog/contracts';
import { CarNotFoundError, extractEventsFromDocument, type CarRepository, type PhotoStorage, type LlmProvider } from '@carlog/domain';
import { ok, type ApiResult } from './errors';
import type { ApiEvent } from './router';

export type ScanDeps = {
  cars: CarRepository;
  storage: PhotoStorage;
  llm: LlmProvider;
  loadScanBase64: (key: string) => Promise<string | null>;
  newId: () => string;
};

export async function handleScanRoute(deps: ScanDeps, event: ApiEvent, ownerId: string): Promise<ApiResult | null> {
  const { method, path, body } = event;

  if (path === '/import/scan/presign' && method === 'POST') {
    const req = ScanPresignRequestSchema.parse(body);
    const ext = req.contentType === 'application/pdf' ? 'pdf' : req.contentType.split('/')[1];
    const key = `scans/${ownerId}/${deps.newId()}.${ext}`;
    const uploadUrl = await deps.storage.presignPut(key, req.contentType, 0);
    return ok(200, { key, uploadUrl });
  }

  if (path === '/import/scan' && method === 'POST') {
    const req = ExtractFromScanRequestSchema.parse(body);
    const car = await deps.cars.getById(ownerId, req.carId);
    if (!car) throw new CarNotFoundError(req.carId);
    if (!req.s3Key.startsWith(`scans/${ownerId}/`)) return ok(400, { error: 'ValidationError', message: 'invalid s3Key' });
    const base64 = await deps.loadScanBase64(req.s3Key);
    if (!base64) return ok(422, { error: 'ExtractionFailed', message: 'Could not read the document' });
    const events = await extractEventsFromDocument(base64, req.contentType, deps.llm, { car: { make: car.make, model: car.model, year: car.year } });
    return ok(200, { events });
  }

  return null;
}
```

- [ ] **Step 2: Wire in `router.ts`** — extend `RouteDeps` with `loadScanBase64: (key: string) => Promise<string | null>;` (import `handleScanRoute`). Add dispatch after the `/import/` job branch, BEFORE the generic import handler if needed (scan paths are `/import/scan*`; ensure the job handler returns null for them — it matches `/import/jobs` and `/import/presign` exactly, so `/import/scan*` falls through). Add:

```ts
if (path.startsWith('/import/scan')) {
  const result = await handleScanRoute(
    { cars: deps.cars, storage: deps.storage, llm: deps.llm, loadScanBase64: deps.loadScanBase64, newId: deps.newId },
    event, ownerId,
  );
  if (result) return result;
}
```

Place this BEFORE the existing `path.startsWith('/import/')` job dispatch (so `/import/scan/presign` isn't swallowed by the job handler's `/import/presign` check — they differ, but ordering scan-first is safest).

- [ ] **Step 3: Router tests (`router.test.ts`)** — add `loadScanBase64: async () => 'BASE64DATA'` to the deps; ensure the in-memory llm fake's `extractEventsFromDocument` returns events. Tests:
  - `POST /import/scan` → 200 with events (car owned).
  - foreign carId → 404.
  - `s3Key` not `scans/u1/…` → 400.
  - `loadScanBase64` returns null → 422.
  - `POST /import/scan/presign` → 200, key matches `^scans/u1/.+`.

- [ ] **Step 4: Handler loader (`handler.ts`)** — add a `loadScanBase64` alongside the existing `loadS3Text`:

```ts
const loadScanBase64 = async (key: string): Promise<string | null> => {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: photosBucket, Key: key }));
    const len = res.ContentLength;
    if (len === undefined || len > MAX_SCAN_SIZE) return null;
    const bytes = await res.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes).toString('base64') : null;
  } catch { return null; }
};
```

Import `MAX_SCAN_SIZE` from `@carlog/contracts`; add `loadScanBase64` to `deps`.

- [ ] **Step 5: Gate** — `pnpm --filter @carlog/api test && typecheck && lint`.
- [ ] **Step 6: Commit** — `git commit -m "feat(api): add scan presign + extract routes with IDOR guard"`

---

### Task 6: CDK — scan routes + scans/ lifecycle

**Files:** Modify `infrastructure/cdk/lib/carlog-stack.ts`

- [ ] **Step 1: Add routes** after the import job routes:

```ts
httpApi.addRoutes({ path: '/import/scan/presign', methods: [HttpMethod.POST], integration, authorizer });
httpApi.addRoutes({ path: '/import/scan', methods: [HttpMethod.POST], integration, authorizer });
```

- [ ] **Step 2: Add lifecycle rule** to `photosBucket.lifecycleRules`:

```ts
{ prefix: 'scans/', expiration: Duration.days(1) },
```

- [ ] **Step 3: Verify** — `pnpm --filter @carlog/cdk typecheck && AWS_PROFILE=yevhenii CDK_DEFAULT_REGION=us-east-1 pnpm --filter @carlog/cdk synth > /tmp/scan-synth.txt 2>&1; echo $?; grep -c 'import/scan' /tmp/scan-synth.txt` → exit 0, ≥1.
- [ ] **Step 4: Commit** — `git commit -m "feat(cdk): add scan routes and scans/ lifecycle rule"`

---

### Task 7: Web — unknown-cost display helper

**Files:** Create `apps/web/src/lib/format-cost.ts` + `format-cost.test.ts`; modify `apps/web/src/components/EventCard.tsx`

**Interfaces produced:** `formatCost(cost: number, currency: string, lang: string): string` — returns `''` when `cost <= 0`, else `"<number> <currency>"`.

- [ ] **Step 1: Failing test `format-cost.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { formatCost } from './format-cost';

describe('formatCost', () => {
  it('returns empty string for zero cost', () => {
    expect(formatCost(0, 'UAH', 'en')).toBe('');
  });
  it('formats a positive cost with currency', () => {
    expect(formatCost(1200, 'UAH', 'en')).toContain('UAH');
    expect(formatCost(1200, 'UAH', 'en')).toMatch(/1,?200/);
  });
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `format-cost.ts`**

```ts
import { formatNumber } from '../i18n/format';

// Cost 0 means "not recorded" — render nothing rather than a misleading "0 UAH".
export function formatCost(cost: number, currency: string, lang: string): string {
  if (!(cost > 0)) return '';
  return `${formatNumber(cost, lang)} ${currency}`;
}
```

- [ ] **Step 4: Use it in `EventCard.tsx`** — replace line 28-30's cost segment:

```tsx
<Typography color="text.secondary">
  {formatNumber(event.mileage, i18n.language)}
  {formatCost(event.cost, event.currency, i18n.language) ? ` · ${formatCost(event.cost, event.currency, i18n.language)}` : ''}
</Typography>
```

(import `formatCost`; keep the `·` separator only when a cost is shown.)

- [ ] **Step 5: Gate** — `pnpm --filter @carlog/web test && typecheck && lint`.
- [ ] **Step 6: Commit** — `git commit -m "feat(web): hide cost when zero (not recorded) in event card"`

---

### Task 8: Web — scan api-client + hook + i18n

**Files:** Modify `apps/web/src/api-client.ts`, `apps/web/src/queries.ts`, `apps/web/src/i18n/locales/{en,uk}/import.json`

**Interfaces produced:** `presignScan(token, contentType, size)`, `extractFromScan(token, carId, s3Key, contentType): Promise<ExtractEventsResponse>`, `confirmProofFromScan(token, carId, eventId, s3Key, contentType)`; hook `useExtractFromScan(carId)`.

- [ ] **Step 1: api-client** — add (reuse the `request` wrapper + `ExtractEventsResponseSchema`, `uploadToS3`):

```ts
const ScanPresignSchema = z.object({ key: z.string(), uploadUrl: z.string().url() });
export const presignScan = (token: string, contentType: string, size: number): Promise<z.infer<typeof ScanPresignSchema>> =>
  request(token, '/import/scan/presign', ScanPresignSchema, { method: 'POST', body: JSON.stringify({ contentType, size }) });
export const extractFromScan = (token: string, carId: string, s3Key: string, contentType: string): Promise<ExtractEventsResponse> =>
  request(token, '/import/scan', ExtractEventsResponseSchema, { method: 'POST', body: JSON.stringify({ carId, s3Key, contentType }) });
export const confirmProofFromScan = (token: string, carId: string, eventId: string, s3Key: string, contentType: string, size: number) =>
  request(token, `/cars/${carId}/events/${eventId}/proofs/from-scan`, ProofSchema, { method: 'POST', body: JSON.stringify({ s3Key, contentType, size }) });
```

(`ProofSchema` is already imported in this file for proofs.)

- [ ] **Step 2: queries** — `useExtractFromScan(carId)`: a mutation taking `{file: File}` that presigns (by `file.type`, `file.size`), `uploadToS3`, then `extractFromScan(token, carId, key, file.type)` and returns `{ events, s3Key: key, contentType: file.type, size: file.size }` so the caller can attach later (the attach needs the byte size). The attach calls `confirmProofFromScan(token, carId, eventId, s3Key, contentType, size)` directly per created event.

- [ ] **Step 3: i18n** (`import` namespace EN+UK, symmetric): `scanInvoice` ("Scan invoice" / "Сканувати рахунок"), `scanning` ("Reading the document…" / "Читаємо документ…"), `scanUnreadable` ("Couldn't read that document. Add the event manually." / "Не вдалося прочитати документ. Додайте подію вручну."), `enterManually` ("Enter manually" / "Ввести вручну"), `scanBadType` ("Choose an image or PDF." / "Оберіть зображення або PDF."), `scanTooLarge` ("File is larger than 10 MB." / "Файл більший за 10 МБ."), `scanAttachFailed` ("Event saved, but attaching the scan failed." / "Подію збережено, але не вдалося прикріпити скан.").

- [ ] **Step 4: Gate** — `pnpm --filter @carlog/web typecheck && lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): scan api-client, extract hook, i18n"`

---

### Task 9: Web — ScanInvoiceDialog + trigger

**Files:** Create `apps/web/src/components/ScanInvoiceDialog.tsx`; modify `apps/web/src/routes/Vehicle.tsx`

**Behavior contract:**
- Trigger: a "Scan invoice" button on the Vehicle screen near the existing import/add controls; opens `ScanInvoiceDialog`.
- Phases: `input` (pick file — accept `image/*,application/pdf`; validate `SCAN_DOC_CONTENT_TYPES` membership → `scanBadType`, size ≤ `MAX_SCAN_SIZE` → `scanTooLarge`; "Scan" button) → `scanning` (spinner + `scanning`) → `review` (the SAME editable candidate-card list as the text import — category/date/mileage/cost/title + remove; unknown cost field editable, blank when 0) → commit.
- Scan: `useExtractFromScan(carId).mutateAsync({file})`. On success store `{events, s3Key, contentType, size}`; if `events.length === 0` show `scanUnreadable` + `enterManually` (closes and opens the normal Add-Event dialog, OR just closes — reuse existing add path). On 422/503 error, reuse `errorFailed`/`errorUnavailable`.
- Commit: for each reviewed candidate → create event via `useCreateEvent(carId).mutateAsync(candidate)` (committed-prefix retry: on failure keep the remainder), then `confirmProofFromScan(token, carId, createdEventId, s3Key, contentType, size)`. If the attach throws, DON'T fail the whole commit — collect a `scanAttachFailed` warning and continue (event stays). After all committed, close.
- Note: `useCreateEvent().mutateAsync` returns the created `Event` — use its `id` for the attach call.
- Strict TS; MUI only; strings via t().

- [ ] **Step 1: Implement `ScanInvoiceDialog.tsx`** per the contract. Reuse the candidate-card rendering shape from `ImportEventsDialog.tsx` (category select via `EVENT_CATEGORIES` + `event:category_*`, date/mileage/cost/title fields, remove button) — you may extract a shared `CandidateEventCards` component if it reduces duplication, but that's optional; if inlining, keep it consistent with the import dialog.

- [ ] **Step 2: Add the trigger to `Vehicle.tsx`** — a "Scan invoice" button near the existing import trigger (the current `ImportEventsDialog` trigger area around line 64-66 / the timeline controls); add `const [scanOpen, setScanOpen] = useState(false);` and render `<ScanInvoiceDialog carId={car.id} open={scanOpen} onClose={() => setScanOpen(false)} />`. Add `'import'` namespace to the screen's `useTranslation` (already present).

- [ ] **Step 3: Gate** — `pnpm --filter @carlog/web typecheck && lint && test && build`; then `grep -c execute-api apps/web/dist/sw.js` → 0.
- [ ] **Step 4: Commit** — `git commit -m "feat(web): scan-invoice dialog with vision extraction, review, and auto-attach"`

---

### Task 10: Deploy + live verification

- [ ] **Step 1: Full gate** — `pnpm turbo run typecheck lint test` → green.
- [ ] **Step 2: Deploy backend** — `AWS_PROFILE=yevhenii CDK_DEFAULT_REGION=us-east-1 pnpm --filter @carlog/cdk exec cdk deploy --require-approval never` → UPDATE_COMPLETE.
- [ ] **Step 3: Deploy web** — `AWS_PROFILE=yevhenii ./scripts/deploy-web.sh`.
- [ ] **Step 4: Live smoke (throwaway user; clean up + revert to SRP-only keeping `COGNITO Google`):**
  1. Standard checks: web/ 200, /login 200, SW execute-api 0, unauth POST /import/scan → 401.
  2. Create a car; generate/obtain a small test invoice image (a JPEG with legible text, e.g. render text to an image, or use a real receipt photo). presign scan → PUT → POST /import/scan → expect 200 with ≥1 event.
  3. IDOR: POST /import/scan with `s3Key: 'photos/other/x.jpg'` → 400.
  4. Commit an event, then POST `/cars/{id}/events/{eventId}/proofs/from-scan` with the scan key → 201; GET proofs → the copied proof is present with a working signed URL.
  5. Unknown-cost: confirm an event with cost 0 shows no "0 UAH" on the deployed timeline (visual/DOM check).
  6. On a browser: scan a real multi-service invoice photo → review list shows ≥1 candidate → commit → events appear with the invoice attached.
- [ ] **Step 5: Finish the branch** — superpowers:finishing-a-development-branch (merge to main after user confirmation).

---

## Self-Review Notes

- **Spec coverage:** scan schemas+from-scan → T1; vision port+use-case (shared retry) → T2; Bedrock vision method (claude-api skill) + fake → T3; CopyObject + from-scan proof route (IDOR + cap + exists) → T4; scan routes (ownership/IDOR/422) + handler base64 loader → T5; CDK routes+lifecycle → T6; unknown-cost display → T7; web client+i18n → T8; dialog+trigger+attach loop → T9; deploy+smoke → T10. Naming rule (no "invoice" in code) honored across tasks. All spec sections mapped.
- **Type consistency:** `extractEventsFromDocument` signature identical in port (T2), fake (T3), use-case (T2), scan route (T5). `PhotoStorage.copyObject` added T4, used T4 route + implemented T4 + faked T4. `ExtractEventsResponseSchema` reused for the scan response (T1 note → T5 route → T8 client). `FromScanProofSchema` T1 → T4 route → T8 client. `formatCost` T7 used in EventCard T7 (and available to the review card).
- **Proof.size resolved:** `Proof` requires `size >= 1` (confirmed in `proof.ts`), so `FromScanProofSchema` carries `size` (the client's `file.size`) end to end (T1 schema → T8 client → T4 route → proof row). No `size: 0`, no HeadObject needed.
- **Placeholder scan:** T9 is a behavior contract (the review-card JSX mirrors the existing ImportEventsDialog, which must not be duplicated verbatim in the plan); every other code step is complete.
- **Risks noted:** claude-api vision block shape (T3 reconciles); route ordering `/import/scan*` before `/import/` job dispatch (T5 Step 2); Proof.size handling (T4).