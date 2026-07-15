# Async Import with .txt Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dialog's synchronous 10k-char import call with an async job pipeline: paste ≤64KB or upload a `.txt` ≤1MB, chunk the text, run each chunk through the existing `extractEvents` use-case in a detached Lambda invocation, poll progress, resume on reopen.

**Architecture:** `POST /import/jobs` writes a job row (single-table, `CAR#<id>#IMPORT#<jobId>`, 24h TTL) and async self-invokes the SAME Lambda; that detached invocation loads the text (inline or S3), chunks it (~10k on line boundaries), calls `extractEvents` per chunk, appends candidates (≤500) and progress to the job row, and completes/fails. The web dialog creates the job, polls `GET /import/jobs/{jobId}` while open, resumes the latest job on reopen, and hands completed results to the unchanged review/commit UI.

**Tech Stack:** TypeScript strict, Zod, `@aws-sdk/client-lambda` (self-invoke), `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-s3`, AWS CDK, React 18 + MUI + TanStack Query + react-i18next, Vitest.

## Global Constraints

- **Caps (verbatim from spec):** paste inline ≤ `IMPORT_INLINE_MAX = 64_000` chars; `.txt` file ≤ `IMPORT_FILE_MAX = 1_048_576` bytes; candidates per job ≤ `MAX_JOB_EVENTS = 500`; chunk size ~10_000 chars split on line boundaries.
- **Clean architecture:** `packages/domain` stays AWS-free — only the pure `chunkText`/`mergeCandidates` helpers go there. Chunk ORCHESTRATION (Dynamo/S3/Lambda side effects) lives in `apps/api` behind ports.
- **The existing `extractEvents` domain use-case and `BedrockLlmProvider` are reused UNCHANGED per chunk.** Do not modify them.
- Zod is the contract source of truth; derive types with `z.infer`. Strict TS, never `any`.
- Job SK = `CAR#<carId>#IMPORT#<jobId>` (4 `#`-segments — the car-list whitelist already excludes it). PK = `USER#<ownerId>`. TTL attribute name: `ttl` (epoch seconds, now+24h).
- Ownership check (404) BEFORE creating any job. Job reads are owner-scoped (foreign job → 404).
- Stale-job guard computed AT READ: a job still `pending`/`running` with `createdAt` older than 20 min is returned as `failed` with `error: 'stale'`.
- Worker deadline guard: when < 60s of Lambda time remains, stop and mark `failed`, `error: 'timeBudgetExceeded'`, KEEPING partial events/progress.
- Per-chunk failure (ExtractionFailedError or LlmUnavailableError from the use-case) → `skippedChunks++`, continue. ALL chunks failed → job `failed`, `error: 'extractionFailed'`.
- `POST /import/extract` (sync) stays deployed and untouched; the dialog stops calling it.
- S3 txt uploads go to the photos bucket under `imports/<ownerId>/<uuid>.txt`, `text/plain`, 1-day lifecycle.
- Strings via `t()` EN+UK; MUI only; extensionless relative imports; conventional commits; NEVER any co-authorship trailer.
- Do NOT set `reservedConcurrentExecutions`. AWS profile `yevhenii`, region us-east-1.
- SW guard after web build: `grep -c execute-api apps/web/dist/sw.js` = 0.

## File Structure

```
packages/contracts/src/import.ts                MODIFY  job schemas + caps (T1)
packages/contracts/src/import.test.ts           MODIFY  schema tests (T1)
packages/domain/src/chunk-text.ts / .test.ts    CREATE  chunkText + mergeCandidates (T2)
packages/domain/src/index.ts                    MODIFY  exports (T2)
apps/api/src/import-job-repository.ts           CREATE  port + Dynamo impl (T3)
apps/api/src/in-memory-import-job-repository.ts CREATE  fake for tests (T3)
apps/api/src/import-worker.ts / .test.ts        CREATE  testable orchestration (T4)
apps/api/src/import-job-routes.ts               CREATE  presign/create/get/query (T5)
apps/api/src/router.ts                          MODIFY  wire routes + deps (T5)
apps/api/src/router.test.ts                     MODIFY  route tests (T5)
apps/api/src/handler.ts                         MODIFY  async payload branch + invoker (T6)
apps/api/package.json                           MODIFY  add @aws-sdk/client-lambda (T6)
infrastructure/cdk/lib/carlog-stack.ts          MODIFY  routes, grant, timeout, lifecycle, TTL (T7)
apps/web/src/api-client.ts                      MODIFY  job client fns (T8)
apps/web/src/queries.ts                         MODIFY  job hooks w/ polling (T8)
apps/web/src/i18n/locales/{en,uk}/import.json   MODIFY  new keys (T8)
apps/web/src/components/ImportEventsDialog.tsx  MODIFY  file input, progress, resume (T9)
```

Order: contracts (1) → domain chunker (2) → job repo (3) → worker (4) → routes (5) → handler/self-invoke (6) → CDK (7) → web plumbing (8) → dialog (9) → deploy+verify (10).

---

### Task 1: Contracts — job schemas and caps

**Files:**
- Modify: `packages/contracts/src/import.ts`, `packages/contracts/src/import.test.ts`

**Interfaces:**
- Consumes: existing `CandidateEventSchema` in the same file.
- Produces (exact names later tasks use): `IMPORT_INLINE_MAX`, `IMPORT_FILE_MAX`, `MAX_JOB_EVENTS`, `IMPORT_CHUNK_SIZE = 10_000`, `CreateImportJobRequestSchema`/`CreateImportJobRequest`, `ImportJobStatusSchema`/`ImportJobStatus`, `ImportJobSchema`/`ImportJob`, `ImportTxtPresignRequestSchema`/`ImportTxtPresignRequest`.

- [ ] **Step 1: Add failing tests to `packages/contracts/src/import.test.ts`**

Append this describe block:

```ts
describe('CreateImportJobRequestSchema', () => {
  const carId = '3f1e9d5a-6b2c-4e8f-9a1b-2c3d4e5f6a7b';
  it('accepts inline text', () => {
    expect(CreateImportJobRequestSchema.safeParse({ carId, text: 'oil change' }).success).toBe(true);
  });
  it('accepts an s3Key', () => {
    expect(CreateImportJobRequestSchema.safeParse({ carId, s3Key: 'imports/u/x.txt' }).success).toBe(true);
  });
  it('rejects both text and s3Key', () => {
    expect(CreateImportJobRequestSchema.safeParse({ carId, text: 'x', s3Key: 'k' }).success).toBe(false);
  });
  it('rejects neither', () => {
    expect(CreateImportJobRequestSchema.safeParse({ carId }).success).toBe(false);
  });
  it('rejects text over the inline cap', () => {
    expect(CreateImportJobRequestSchema.safeParse({ carId, text: 'a'.repeat(IMPORT_INLINE_MAX + 1) }).success).toBe(false);
  });
});

describe('ImportJobSchema', () => {
  it('parses a fresh job with defaults', () => {
    const job = ImportJobSchema.parse({
      id: '3f1e9d5a-6b2c-4e8f-9a1b-2c3d4e5f6a7b',
      carId: '3f1e9d5a-6b2c-4e8f-9a1b-2c3d4e5f6a7c',
      status: 'pending',
      progress: { done: 0, total: 0, found: 0 },
      createdAt: '2026-07-15T10:00:00.000Z',
    });
    expect(job.events).toEqual([]);
    expect(job.skippedChunks).toBe(0);
  });
  it('rejects an unknown status', () => {
    expect(ImportJobStatusSchema.safeParse('paused').success).toBe(false);
  });
});
```

Add the new names to the import at the top of the test file: `CreateImportJobRequestSchema, ImportJobSchema, ImportJobStatusSchema, IMPORT_INLINE_MAX`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @carlog/contracts test`
Expected: FAIL — names not exported.

- [ ] **Step 3: Append to `packages/contracts/src/import.ts`**

```ts
export const IMPORT_INLINE_MAX = 64_000;
export const IMPORT_FILE_MAX = 1_048_576;
export const MAX_JOB_EVENTS = 500;
export const IMPORT_CHUNK_SIZE = 10_000;

export const CreateImportJobRequestSchema = z.object({
  carId: z.string().uuid(),
  text: z.string().min(1).max(IMPORT_INLINE_MAX).optional(),
  s3Key: z.string().min(1).optional(),
}).refine((v) => Boolean(v.text) !== Boolean(v.s3Key), { message: 'exactly one of text or s3Key' });
export type CreateImportJobRequest = z.infer<typeof CreateImportJobRequestSchema>;

export const ImportJobStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);
export type ImportJobStatus = z.infer<typeof ImportJobStatusSchema>;

export const ImportJobSchema = z.object({
  id: z.string().uuid(),
  carId: z.string().uuid(),
  status: ImportJobStatusSchema,
  progress: z.object({
    done: z.number().int().min(0),
    total: z.number().int().min(0),
    found: z.number().int().min(0),
  }),
  events: z.array(CandidateEventSchema).max(MAX_JOB_EVENTS).default([]),
  skippedChunks: z.number().int().min(0).default(0),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type ImportJob = z.infer<typeof ImportJobSchema>;

export const ImportTxtPresignRequestSchema = z.object({
  size: z.number().int().min(1).max(IMPORT_FILE_MAX),
});
export type ImportTxtPresignRequest = z.infer<typeof ImportTxtPresignRequestSchema>;
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @carlog/contracts test && pnpm --filter @carlog/contracts typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/import.ts packages/contracts/src/import.test.ts
git commit -m "feat(contracts): add import job schemas and size caps"
```

---

### Task 2: Domain — chunkText + mergeCandidates (pure)

**Files:**
- Create: `packages/domain/src/chunk-text.ts`, `packages/domain/src/chunk-text.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces: `chunkText(text: string, maxLen: number): string[]`; `mergeCandidates<T>(lists: T[][], cap: number): T[]`.

- [ ] **Step 1: Write failing test `packages/domain/src/chunk-text.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { chunkText, mergeCandidates } from './chunk-text';

describe('chunkText', () => {
  it('returns one chunk when text fits', () => {
    expect(chunkText('a\nb\nc', 100)).toEqual(['a\nb\nc']);
  });
  it('splits on line boundaries, never mid-line', () => {
    const lines = ['111111', '222222', '333333']; // 6 chars each
    const chunks = chunkText(lines.join('\n'), 14); // fits 2 lines + newline per chunk
    expect(chunks).toEqual(['111111\n222222', '333333']);
  });
  it('hard-splits a single line longer than maxLen', () => {
    const chunks = chunkText('x'.repeat(25), 10);
    expect(chunks).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
  });
  it('produces no empty chunks and preserves order', () => {
    const chunks = chunkText('a\n\n\nb\nc', 3);
    expect(chunks.every((c) => c.length > 0)).toBe(true);
    expect(chunks.join('\n').replace(/\n+/g, '\n')).toContain('a');
  });
  it('returns [] for empty/whitespace-only text', () => {
    expect(chunkText('', 10)).toEqual([]);
    expect(chunkText('  \n \n ', 10)).toEqual([]);
  });
});

describe('mergeCandidates', () => {
  it('merges in order and truncates at the cap', () => {
    expect(mergeCandidates([[1, 2], [3, 4], [5]], 4)).toEqual([1, 2, 3, 4]);
  });
  it('handles empty lists', () => {
    expect(mergeCandidates([[], [1], []], 10)).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @carlog/domain test src/chunk-text.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/domain/src/chunk-text.ts`**

```ts
// Split free text into chunks of at most maxLen characters, breaking on line
// boundaries. A single line longer than maxLen is hard-split. Whitespace-only
// lines are dropped when they would start a chunk; no empty chunks are produced.
export function chunkText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let current = '';
  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed.length > 0) chunks.push(current);
    current = '';
  };
  for (const line of text.split('\n')) {
    if (line.length > maxLen) {
      pushCurrent();
      for (let i = 0; i < line.length; i += maxLen) chunks.push(line.slice(i, i + maxLen));
      continue;
    }
    const candidate = current.length === 0 ? line : `${current}\n${line}`;
    if (candidate.length > maxLen) {
      pushCurrent();
      current = line;
    } else {
      current = candidate;
    }
  }
  pushCurrent();
  return chunks.filter((c) => c.trim().length > 0);
}

// Flat merge preserving list order, truncated at cap.
export function mergeCandidates<T>(lists: T[][], cap: number): T[] {
  const out: T[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (out.length >= cap) return out;
      out.push(item);
    }
  }
  return out;
}
```

- [ ] **Step 4: Export from `packages/domain/src/index.ts`** — add `export { chunkText, mergeCandidates } from './chunk-text';`

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @carlog/domain test && pnpm --filter @carlog/domain typecheck`
Expected: PASS (existing extract-events tests + new chunk tests).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/chunk-text.ts packages/domain/src/chunk-text.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): add pure chunkText and mergeCandidates helpers"
```

---

### Task 3: API — import-job repository (port + Dynamo + fake)

**Files:**
- Create: `apps/api/src/import-job-repository.ts`, `apps/api/src/in-memory-import-job-repository.ts`

**Interfaces:**
- Consumes: `ImportJob` from `@carlog/contracts`.
- Produces:
  ```ts
  export type ImportJobRecord = ImportJob & { ownerId: string; text?: string; s3Key?: string };
  export interface ImportJobRepository {
    create(job: ImportJobRecord): Promise<void>;
    get(ownerId: string, carId: string, jobId: string): Promise<ImportJobRecord | null>;
    latestForCar(ownerId: string, carId: string): Promise<ImportJobRecord | null>;
    update(job: ImportJobRecord): Promise<void>;   // full-row put (matches repo conventions)
  }
  export class DynamoImportJobRepository implements ImportJobRepository { ... }
  export const importJobSk = (carId: string, jobId: string) => `CAR#${carId}#IMPORT#${jobId}`;
  ```
- `InMemoryImportJobRepository implements ImportJobRepository` — single `Map<string, ImportJobRecord>` keyed by `PK|SK` (single-SK-map convention from the other fakes, so SK collisions surface in tests).

- [ ] **Step 1: Create `apps/api/src/import-job-repository.ts`**

```ts
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ImportJob } from '@carlog/contracts';

// The stored record carries the input source (inline text or S3 key) and the owner;
// neither is returned by the API (routes strip to the ImportJob shape).
export type ImportJobRecord = ImportJob & { ownerId: string; text?: string; s3Key?: string };

export interface ImportJobRepository {
  create(job: ImportJobRecord): Promise<void>;
  get(ownerId: string, carId: string, jobId: string): Promise<ImportJobRecord | null>;
  latestForCar(ownerId: string, carId: string): Promise<ImportJobRecord | null>;
  update(job: ImportJobRecord): Promise<void>;
}

export const importJobSk = (carId: string, jobId: string): string => `CAR#${carId}#IMPORT#${jobId}`;
const pk = (ownerId: string) => `USER#${ownerId}`;
const TTL_SECONDS = 24 * 60 * 60;

type Row = ImportJobRecord & { PK: string; SK: string; ttl: number };
const toRow = (j: ImportJobRecord): Row => ({
  ...j, PK: pk(j.ownerId), SK: importJobSk(j.carId, j.id),
  ttl: Math.floor(Date.parse(j.createdAt) / 1000) + TTL_SECONDS,
});
const toRecord = (row: Record<string, unknown>): ImportJobRecord => {
  const { PK, SK, ttl, ...job } = row as Row;
  return job;
};

export class DynamoImportJobRepository implements ImportJobRepository {
  constructor(private readonly tableName: string, private readonly client: DynamoDBDocumentClient) {}

  async create(job: ImportJobRecord): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(job) }));
  }
  async get(ownerId: string, carId: string, jobId: string): Promise<ImportJobRecord | null> {
    const res = await this.client.send(new GetCommand({
      TableName: this.tableName, Key: { PK: pk(ownerId), SK: importJobSk(carId, jobId) },
    }));
    return res.Item ? toRecord(res.Item) : null;
  }
  async latestForCar(ownerId: string, carId: string): Promise<ImportJobRecord | null> {
    const res = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk(ownerId), ':sk': `CAR#${carId}#IMPORT#` },
    }));
    const jobs = (res.Items ?? []).map(toRecord);
    if (jobs.length === 0) return null;
    jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return jobs[0] ?? null;
  }
  async update(job: ImportJobRecord): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(job) }));
  }
}
```

- [ ] **Step 2: Create `apps/api/src/in-memory-import-job-repository.ts`**

```ts
import type { ImportJobRecord, ImportJobRepository } from './import-job-repository';
import { importJobSk } from './import-job-repository';

// Single map keyed by PK|SK so key collisions surface in tests (repo convention).
export class InMemoryImportJobRepository implements ImportJobRepository {
  private rows = new Map<string, ImportJobRecord>();
  private key(ownerId: string, carId: string, jobId: string): string {
    return `USER#${ownerId}|${importJobSk(carId, jobId)}`;
  }
  async create(job: ImportJobRecord): Promise<void> {
    this.rows.set(this.key(job.ownerId, job.carId, job.id), structuredClone(job));
  }
  async get(ownerId: string, carId: string, jobId: string): Promise<ImportJobRecord | null> {
    return structuredClone(this.rows.get(this.key(ownerId, carId, jobId)) ?? null);
  }
  async latestForCar(ownerId: string, carId: string): Promise<ImportJobRecord | null> {
    const prefix = `USER#${ownerId}|CAR#${carId}#IMPORT#`;
    const jobs = [...this.rows.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
    if (jobs.length === 0) return null;
    jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return structuredClone(jobs[0] ?? null);
  }
  async update(job: ImportJobRecord): Promise<void> {
    this.rows.set(this.key(job.ownerId, job.carId, job.id), structuredClone(job));
  }
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @carlog/api typecheck && pnpm --filter @carlog/api lint`
Expected: PASS (repo not yet wired anywhere; tests come with the worker/routes).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/import-job-repository.ts apps/api/src/in-memory-import-job-repository.ts
git commit -m "feat(api): add import-job repository port with Dynamo and in-memory impls"
```

---

### Task 4: API — import worker (testable orchestration)

**Files:**
- Create: `apps/api/src/import-worker.ts`, `apps/api/src/import-worker.test.ts`

**Interfaces:**
- Consumes: `chunkText`, `mergeCandidates`, `extractEvents`, types `LlmProvider`, `ExtractionContext` from `@carlog/domain`; `IMPORT_CHUNK_SIZE`, `MAX_JOB_EVENTS`, `IMPORT_FILE_MAX` from `@carlog/contracts`; `ImportJobRepository`, `ImportJobRecord` from `./import-job-repository`; `CarRepository` from `@carlog/domain`.
- Produces:
  ```ts
  export type ImportWorkerDeps = {
    jobs: ImportJobRepository;
    cars: CarRepository;
    llm: LlmProvider;
    loadS3Text: (key: string) => Promise<string | null>;  // null = missing; throws never
    remainingMs: () => number;                             // Lambda context deadline
  };
  export type ImportWorkPayload = { jobType: 'import'; ownerId: string; carId: string; jobId: string };
  export function runImportJob(deps: ImportWorkerDeps, payload: ImportWorkPayload): Promise<void>;
  ```

- [ ] **Step 1: Write failing tests `apps/api/src/import-worker.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { runImportJob, type ImportWorkerDeps } from './import-worker';
import { InMemoryImportJobRepository } from './in-memory-import-job-repository';
import { InMemoryCarRepository } from './in-memory-car-repository';
import { InMemoryLlmProvider } from './in-memory-llm-provider';
import type { ImportJobRecord } from './import-job-repository';

const OWNER = 'u1';
const valid = { date: '2024-01-15', mileage: 45000, cost: 1200, category: 'oil_change' };

function makeJob(overrides: Partial<ImportJobRecord>): ImportJobRecord {
  return {
    id: '3f1e9d5a-6b2c-4e8f-9a1b-2c3d4e5f6a7b',
    carId: '',
    ownerId: OWNER,
    status: 'pending',
    progress: { done: 0, total: 0, found: 0 },
    events: [], skippedChunks: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('runImportJob', () => {
  let jobs: InMemoryImportJobRepository;
  let cars: InMemoryCarRepository;
  let carId: string;

  beforeEach(async () => {
    jobs = new InMemoryImportJobRepository();
    cars = new InMemoryCarRepository();
    const car = await cars.create({
      id: '9f1e9d5a-6b2c-4e8f-9a1b-2c3d4e5f6a7b', ownerId: OWNER,
      make: 'Toyota', model: 'Corolla', year: 2020, mileage: 45000, fuelType: 'petrol',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    carId = car.id;
  });

  const deps = (llmOutput: unknown, extra?: Partial<ImportWorkerDeps>): ImportWorkerDeps => ({
    jobs, cars,
    llm: new InMemoryLlmProvider(llmOutput),
    loadS3Text: async () => null,
    remainingMs: () => 300_000,
    ...extra,
  });

  it('processes inline text to completed with events and progress', async () => {
    const job = makeJob({ carId, text: 'oil change jan 2024' });
    await jobs.create(job);
    await runImportJob(deps({ events: [valid] }), { jobType: 'import', ownerId: OWNER, carId, jobId: job.id });
    const done = await jobs.get(OWNER, carId, job.id);
    expect(done?.status).toBe('completed');
    expect(done?.events).toHaveLength(1);
    expect(done?.progress).toMatchObject({ done: 1, total: 1, found: 1 });
  });

  it('splits long text into multiple chunks and merges results', async () => {
    const line = 'oil change at 45000 km, 1200 UAH'.padEnd(200, '.');
    const text = Array.from({ length: 120 }, () => line).join('\n'); // ~24k chars → 3 chunks
    const job = makeJob({ carId, text });
    await jobs.create(job);
    await runImportJob(deps({ events: [valid] }), { jobType: 'import', ownerId: OWNER, carId, jobId: job.id });
    const done = await jobs.get(OWNER, carId, job.id);
    expect(done?.status).toBe('completed');
    expect(done?.progress.total).toBeGreaterThan(1);
    expect(done?.events.length).toBe(done?.progress.total); // one event per chunk from the fake
  });

  it('skips a failing chunk and completes with skippedChunks accounted', async () => {
    // Fake returns shapeless output → extractEvents throws per chunk. Only chunk-level
    // failure matters here, so a provider that always fails yields all-skipped → failed;
    // to test partial skip we alternate via a stateful provider.
    let call = 0;
    const alternating = { extractEvents: async () => (call++ % 2 === 0 ? { events: [valid] } : 'garbage') };
    const line = 'x'.padEnd(9000, 'y');
    const text = `${line}\n${line}`; // 2 chunks
    const job = makeJob({ carId, text });
    await jobs.create(job);
    await runImportJob(deps(null, { llm: alternating }), { jobType: 'import', ownerId: OWNER, carId, jobId: job.id });
    const done = await jobs.get(OWNER, carId, job.id);
    expect(done?.status).toBe('completed');
    expect(done?.skippedChunks).toBe(1);
    expect(done?.events).toHaveLength(1);
  });

  it('fails the job when ALL chunks fail', async () => {
    const job = makeJob({ carId, text: 'some text' });
    await jobs.create(job);
    await runImportJob(deps('never valid'), { jobType: 'import', ownerId: OWNER, carId, jobId: job.id });
    const done = await jobs.get(OWNER, carId, job.id);
    expect(done?.status).toBe('failed');
    expect(done?.error).toBe('extractionFailed');
  });

  it('fails with fileMissing when the S3 object is gone', async () => {
    const job = makeJob({ carId, s3Key: 'imports/u1/gone.txt' });
    await jobs.create(job);
    await runImportJob(deps({ events: [valid] }), { jobType: 'import', ownerId: OWNER, carId, jobId: job.id });
    const done = await jobs.get(OWNER, carId, job.id);
    expect(done?.status).toBe('failed');
    expect(done?.error).toBe('fileMissing');
  });

  it('stops early with timeBudgetExceeded, keeping partial results', async () => {
    const line = 'x'.padEnd(9000, 'y');
    const text = `${line}\n${line}\n${line}`; // 3 chunks
    const job = makeJob({ carId, text });
    await jobs.create(job);
    let calls = 0;
    const budget = () => (calls === 0 ? 300_000 : 30_000); // after first chunk, <60s left
    const counting = { extractEvents: async () => { calls++; return { events: [valid] }; } };
    await runImportJob(deps(null, { llm: counting, remainingMs: budget }), { jobType: 'import', ownerId: OWNER, carId, jobId: job.id });
    const done = await jobs.get(OWNER, carId, job.id);
    expect(done?.status).toBe('failed');
    expect(done?.error).toBe('timeBudgetExceeded');
    expect(done?.events.length).toBeGreaterThan(0);
  });

  it('does nothing when the job row is missing', async () => {
    await expect(
      runImportJob(deps({ events: [valid] }), { jobType: 'import', ownerId: OWNER, carId, jobId: 'missing' }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @carlog/api test src/import-worker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/api/src/import-worker.ts`**

```ts
import {
  chunkText, extractEvents, type CarRepository, type LlmProvider,
} from '@carlog/domain';
import { IMPORT_CHUNK_SIZE, MAX_JOB_EVENTS } from '@carlog/contracts';
import type { ImportJobRecord, ImportJobRepository } from './import-job-repository';

export type ImportWorkerDeps = {
  jobs: ImportJobRepository;
  cars: CarRepository;
  llm: LlmProvider;
  loadS3Text: (key: string) => Promise<string | null>;
  remainingMs: () => number;
};

export type ImportWorkPayload = { jobType: 'import'; ownerId: string; carId: string; jobId: string };

const MIN_BUDGET_MS = 60_000;

// Detached-invocation entry point: loads the job's text, chunks it, and runs each chunk
// through the existing extractEvents use-case, persisting progress after every chunk so
// the polling GET sees live numbers. Per-chunk failures are skipped; the job only fails
// outright when nothing could be extracted, the file is missing, or time runs out.
export async function runImportJob(deps: ImportWorkerDeps, payload: ImportWorkPayload): Promise<void> {
  const job = await deps.jobs.get(payload.ownerId, payload.carId, payload.jobId);
  if (!job) return; // row expired or bogus payload — nothing to do

  const fail = async (error: string): Promise<void> => {
    await deps.jobs.update({ ...job, status: 'failed', error });
  };

  const car = await deps.cars.getById(payload.ownerId, payload.carId);
  if (!car) return fail('carMissing');

  let text: string | null = job.text ?? null;
  if (!text && job.s3Key) text = await deps.loadS3Text(job.s3Key);
  if (!text || text.trim().length === 0) return fail('fileMissing');

  const chunks = chunkText(text, IMPORT_CHUNK_SIZE);
  if (chunks.length === 0) return fail('fileMissing');

  job.status = 'running';
  job.progress = { done: 0, total: chunks.length, found: 0 };
  await deps.jobs.update(job);

  const ctx = { car: { make: car.make, model: car.model, year: car.year } };
  for (const chunk of chunks) {
    if (deps.remainingMs() < MIN_BUDGET_MS) {
      return fail('timeBudgetExceeded'); // partial events/progress already persisted on `job`
    }
    try {
      const found = await extractEvents(chunk, deps.llm, ctx);
      const room = MAX_JOB_EVENTS - job.events.length;
      job.events.push(...found.slice(0, Math.max(0, room)));
      job.progress.found = job.events.length;
    } catch {
      job.skippedChunks += 1; // ExtractionFailed or LlmUnavailable — skip this chunk
    }
    job.progress.done += 1;
    await deps.jobs.update(job);
  }

  if (job.events.length === 0 && job.skippedChunks === job.progress.total) {
    return fail('extractionFailed');
  }
  job.status = 'completed';
  await deps.jobs.update(job);
}
```

Note: `fail` reuses the in-memory `job` object, so partial `events`/`progress` mutated before the failure are persisted with the failed status — that is what the timeBudget test asserts.

- [ ] **Step 4: Run tests + typecheck + lint**

Run: `pnpm --filter @carlog/api test && pnpm --filter @carlog/api typecheck && pnpm --filter @carlog/api lint`
Expected: PASS (7 new worker tests + existing 28).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/import-worker.ts apps/api/src/import-worker.test.ts
git commit -m "feat(api): add chunked import worker with progress, skip and budget guards"
```

---

### Task 5: API — job routes + router wiring

**Files:**
- Create: `apps/api/src/import-job-routes.ts`
- Modify: `apps/api/src/router.ts`, `apps/api/src/router.test.ts`

**Interfaces:**
- Consumes: `CreateImportJobRequestSchema`, `ImportTxtPresignRequestSchema`, `ImportJobSchema`, `IMPORT_FILE_MAX` from `@carlog/contracts`; `CarNotFoundError` from `@carlog/domain`; `ImportJobRepository`, `ImportJobRecord` from `./import-job-repository`; existing `ok`/`ApiResult`, `PhotoStorage` port (reused for the txt presign).
- Produces:
  ```ts
  export type ImportJobDeps = {
    cars: CarRepository; jobs: ImportJobRepository; storage: PhotoStorage;
    enqueueImport: (payload: ImportWorkPayload) => Promise<void>;   // async self-invoke; injected
    newId: () => string;                                            // uuid seam for tests
  };
  export function handleImportJobRoute(deps: ImportJobDeps, event: ApiEvent, ownerId: string): Promise<ApiResult | null>;
  ```
- `RouteDeps` gains `importJobs: ImportJobRepository; enqueueImport: (p: ImportWorkPayload) => Promise<void>; newId: () => string;`
- Stale-job rule (AT READ): status `pending`/`running` AND `createdAt` > 20 min old → returned as `{...job, status:'failed', error:'stale'}`.

- [ ] **Step 1: Create `apps/api/src/import-job-routes.ts`**

```ts
import {
  CreateImportJobRequestSchema, ImportTxtPresignRequestSchema, type ImportJob,
} from '@carlog/contracts';
import { CarNotFoundError, type CarRepository, type PhotoStorage } from '@carlog/domain';
import { ok, type ApiResult } from './errors';
import type { ImportJobRecord, ImportJobRepository } from './import-job-repository';
import type { ImportWorkPayload } from './import-worker';
import type { ApiEvent } from './router';

export type ImportJobDeps = {
  cars: CarRepository;
  jobs: ImportJobRepository;
  storage: PhotoStorage;
  enqueueImport: (payload: ImportWorkPayload) => Promise<void>;
  newId: () => string;
};

const STALE_MS = 20 * 60 * 1000;

// The API returns the ImportJob shape only — the stored record's ownerId/text/s3Key stay server-side.
function toApiJob(rec: ImportJobRecord): ImportJob {
  const { ownerId, text, s3Key, ...job } = rec;
  if ((job.status === 'pending' || job.status === 'running') && Date.now() - Date.parse(job.createdAt) > STALE_MS) {
    return { ...job, status: 'failed', error: 'stale' };
  }
  return job;
}

// Handles /import/presign, /import/jobs, /import/jobs/{jobId}; returns null if not matched.
export async function handleImportJobRoute(
  deps: ImportJobDeps, event: ApiEvent, ownerId: string,
): Promise<ApiResult | null> {
  const { method, path, pathParams, body, queryParams } = event;

  if (path === '/import/presign' && method === 'POST') {
    ImportTxtPresignRequestSchema.parse(body);
    const key = `imports/${ownerId}/${deps.newId()}.txt`;
    const uploadUrl = await deps.storage.presignPut(key, 'text/plain', 0);
    return ok(200, { key, uploadUrl });
  }

  if (path === '/import/jobs' && method === 'POST') {
    const req = CreateImportJobRequestSchema.parse(body);
    const car = await deps.cars.getById(ownerId, req.carId);
    if (!car) throw new CarNotFoundError(req.carId);
    const job: ImportJobRecord = {
      id: deps.newId(), carId: req.carId, ownerId,
      status: 'pending', progress: { done: 0, total: 0, found: 0 },
      events: [], skippedChunks: 0, createdAt: new Date().toISOString(),
      ...(req.text ? { text: req.text } : {}), ...(req.s3Key ? { s3Key: req.s3Key } : {}),
    };
    await deps.jobs.create(job);
    await deps.enqueueImport({ jobType: 'import', ownerId, carId: req.carId, jobId: job.id });
    return ok(202, { jobId: job.id });
  }

  if (path === '/import/jobs' && method === 'GET') {
    const carId = queryParams.carId;
    if (!carId) return ok(400, { error: 'ValidationError', message: 'carId query param required' });
    const latest = await deps.jobs.latestForCar(ownerId, carId);
    if (!latest) return ok(404, { error: 'NotFound', message: 'No import job for car' });
    return ok(200, toApiJob(latest));
  }

  const jobId = pathParams.jobId;
  if (jobId && path === `/import/jobs/${jobId}` && method === 'GET') {
    const carId = queryParams.carId;
    if (!carId) return ok(400, { error: 'ValidationError', message: 'carId query param required' });
    const job = await deps.jobs.get(ownerId, carId, jobId);
    if (!job) return ok(404, { error: 'NotFound', message: 'Import job not found' });
    return ok(200, toApiJob(job));
  }

  return null;
}
```

Note: `GET /import/jobs/{jobId}` needs the carId to build the SK — the client always knows it; pass `?carId=`.

- [ ] **Step 2: Add `queryParams` to `ApiEvent` in `apps/api/src/router.ts`**

`ApiEvent` currently lacks query params. Extend the type and the dispatch:

```ts
export type ApiEvent = {
  method: string;
  path: string;
  ownerId: string | null;
  pathParams: Record<string, string>;
  queryParams: Record<string, string>;
  body: unknown;
};
```

Extend `RouteDeps` with `importJobs: ImportJobRepository; enqueueImport: (p: ImportWorkPayload) => Promise<void>; newId: () => string;` (import the types), and add the dispatch after the existing `/import/extract` branch:

```ts
    if (path.startsWith('/import/')) {
      const result = await handleImportJobRoute(
        { cars: deps.cars, jobs: deps.importJobs, storage: deps.storage, enqueueImport: deps.enqueueImport, newId: deps.newId },
        event, ownerId,
      );
      if (result) return result;
    }
```

Place this AFTER the `/import/extract` dispatch (extract keeps priority; the new handler returns null for that path). All existing `route(deps, {...})` test calls construct ApiEvent literals via a `base` object — update `base` to include `queryParams: {}` so existing tests keep compiling.

- [ ] **Step 3: Add router tests to `apps/api/src/router.test.ts`**

Update the deps construction: `importJobs: new InMemoryImportJobRepository(), enqueueImport: enqueueSpy, newId: () => crypto.randomUUID()` where `enqueueSpy` is a `vi.fn().mockResolvedValue(undefined)` recreated in `beforeEach`. Update `base` to include `queryParams: {}`. Add:

```ts
describe('import jobs', () => {
  async function makeCar(ownerId: string): Promise<string> {
    const res = await route(deps, { ...base, method: 'POST', path: '/cars', ownerId, body: validBody });
    return JSON.parse(res.body).id as string;
  }

  it('creates a job (202) and enqueues the worker payload', async () => {
    const carId = await makeCar('u1');
    const res = await route(deps, { ...base, method: 'POST', path: '/import/jobs', ownerId: 'u1', body: { carId, text: 'oil change 2024' } });
    expect(res.statusCode).toBe(202);
    const { jobId } = JSON.parse(res.body);
    expect(jobId).toBeDefined();
    expect(enqueueSpy).toHaveBeenCalledWith({ jobType: 'import', ownerId: 'u1', carId, jobId });
  });

  it('404s job creation for a foreign car', async () => {
    const carId = await makeCar('u1');
    const res = await route(deps, { ...base, method: 'POST', path: '/import/jobs', ownerId: 'u2', body: { carId, text: 'x' } });
    expect(res.statusCode).toBe(404);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('400s when both text and s3Key are given', async () => {
    const carId = await makeCar('u1');
    const res = await route(deps, { ...base, method: 'POST', path: '/import/jobs', ownerId: 'u1', body: { carId, text: 'x', s3Key: 'k' } });
    expect(res.statusCode).toBe(400);
  });

  it('gets a job by id and hides server-side fields', async () => {
    const carId = await makeCar('u1');
    const created = await route(deps, { ...base, method: 'POST', path: '/import/jobs', ownerId: 'u1', body: { carId, text: 'oil change' } });
    const { jobId } = JSON.parse(created.body);
    const res = await route(deps, { ...base, method: 'GET', path: `/import/jobs/${jobId}`, ownerId: 'u1', pathParams: { jobId }, queryParams: { carId } });
    expect(res.statusCode).toBe(200);
    const job = JSON.parse(res.body);
    expect(job.status).toBe('pending');
    expect(job.text).toBeUndefined();
    expect(job.ownerId).toBeUndefined();
  });

  it('returns the latest job for a car and 404 when none', async () => {
    const carId = await makeCar('u1');
    const none = await route(deps, { ...base, method: 'GET', path: '/import/jobs', ownerId: 'u1', queryParams: { carId } });
    expect(none.statusCode).toBe(404);
    await route(deps, { ...base, method: 'POST', path: '/import/jobs', ownerId: 'u1', body: { carId, text: 'first' } });
    const res = await route(deps, { ...base, method: 'GET', path: '/import/jobs', ownerId: 'u1', queryParams: { carId } });
    expect(res.statusCode).toBe(200);
  });

  it('reports a stale running job as failed at read', async () => {
    const carId = await makeCar('u1');
    const old = new Date(Date.now() - 21 * 60 * 1000).toISOString();
    await deps.importJobs.create({
      id: crypto.randomUUID(), carId, ownerId: 'u1', status: 'running',
      progress: { done: 1, total: 3, found: 2 }, events: [], skippedChunks: 0, createdAt: old,
    });
    const res = await route(deps, { ...base, method: 'GET', path: '/import/jobs', ownerId: 'u1', queryParams: { carId } });
    const job = JSON.parse(res.body);
    expect(job.status).toBe('failed');
    expect(job.error).toBe('stale');
  });

  it('presigns a txt upload under the imports prefix', async () => {
    const res = await route(deps, { ...base, method: 'POST', path: '/import/presign', ownerId: 'u1', body: { size: 1000 } });
    expect(res.statusCode).toBe(200);
    const { key, uploadUrl } = JSON.parse(res.body);
    expect(key).toMatch(/^imports\/u1\/.+\.txt$/);
    expect(uploadUrl).toContain('https://');
  });
});
```

- [ ] **Step 4: Run tests + typecheck + lint**

Run: `pnpm --filter @carlog/api test && pnpm --filter @carlog/api typecheck && pnpm --filter @carlog/api lint`
Expected: PASS. NOTE: `handler.ts` will fail typecheck until it supplies the new deps — add an interim wiring there in this task if needed: `importJobs: new DynamoImportJobRepository(tableName, client), enqueueImport: async () => { throw new Error('not wired until Task 6'); }, newId: () => crypto.randomUUID()`. (Task 6 replaces the throwing stub with the real self-invoker — the established interim-stub pattern.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/import-job-routes.ts apps/api/src/router.ts apps/api/src/router.test.ts apps/api/src/handler.ts
git commit -m "feat(api): add import job routes (presign, create, get, latest) with stale guard"
```

---

### Task 6: API — handler async branch + Lambda self-invoke

**Files:**
- Modify: `apps/api/src/handler.ts`, `apps/api/package.json`

**Interfaces:**
- Consumes: `runImportJob`, `ImportWorkPayload`, `ImportWorkerDeps` (T4); `DynamoImportJobRepository` (T3); everything already in handler.
- Produces: the deployed Lambda accepts BOTH API Gateway events and `{jobType:'import',...}` payloads; `enqueueImport` uses `@aws-sdk/client-lambda` `InvokeCommand` with `InvocationType: 'Event'` against `process.env.AWS_LAMBDA_FUNCTION_NAME`.

- [ ] **Step 1: Add the dependency**

In `apps/api/package.json` dependencies add `"@aws-sdk/client-lambda": "^3.658.0"`, then run `pnpm install`.

- [ ] **Step 2: Rewrite `apps/api/src/handler.ts`**

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2, Context,
} from 'aws-lambda';
import { IMPORT_FILE_MAX } from '@carlog/contracts';
import { DynamoCarRepository } from './dynamo-car-repository';
import { DynamoPhotoRepository } from './dynamo-photo-repository';
import { DynamoEventRepository } from './dynamo-event-repository';
import { DynamoProofRepository } from './dynamo-proof-repository';
import { DynamoImportJobRepository } from './import-job-repository';
import { S3PhotoStorage } from './s3-photo-storage';
import { BedrockLlmProvider } from './bedrock-llm-provider';
import { runImportJob, type ImportWorkPayload } from './import-worker';
import { route, type ApiEvent, type RouteDeps } from './router';

const tableName = process.env.TABLE_NAME ?? '';
const photosBucket = process.env.PHOTOS_BUCKET ?? '';
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});
const lambda = new LambdaClient({});
const llm = new BedrockLlmProvider();
const cars = new DynamoCarRepository(tableName, client);
const importJobs = new DynamoImportJobRepository(tableName, client);

const enqueueImport = async (payload: ImportWorkPayload): Promise<void> => {
  await lambda.send(new InvokeCommand({
    FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
};

// Reads the uploaded txt; null when missing or oversized (worker maps both to a failed job).
const loadS3Text = async (key: string): Promise<string | null> => {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: photosBucket, Key: key }));
    if ((res.ContentLength ?? 0) > IMPORT_FILE_MAX) return null;
    return (await res.Body?.transformToString('utf-8')) ?? null;
  } catch {
    return null;
  }
};

const deps: RouteDeps = {
  cars,
  photos: new DynamoPhotoRepository(tableName, client),
  storage: new S3PhotoStorage(photosBucket, s3),
  events: new DynamoEventRepository(tableName, client),
  proofs: new DynamoProofRepository(tableName, client),
  llm,
  importJobs,
  enqueueImport,
  newId: () => crypto.randomUUID(),
};

const isImportPayload = (e: unknown): e is ImportWorkPayload =>
  typeof e === 'object' && e !== null && (e as { jobType?: unknown }).jobType === 'import';

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer | ImportWorkPayload,
  context: Context,
): Promise<APIGatewayProxyResultV2 | void> {
  // Detached worker invocation (async self-invoke) — no API Gateway envelope.
  if (isImportPayload(event)) {
    await runImportJob(
      { jobs: importJobs, cars, llm, loadS3Text, remainingMs: () => context.getRemainingTimeInMillis() },
      event,
    );
    return;
  }

  const apiEvent: ApiEvent = {
    method: event.requestContext.http.method,
    path: event.requestContext.http.path,
    ownerId: event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined ?? null,
    pathParams: event.pathParameters ? (event.pathParameters as Record<string, string>) : {},
    queryParams: event.queryStringParameters ? (event.queryStringParameters as Record<string, string>) : {},
    body: event.body ? JSON.parse(event.body) : null,
  };
  const result = await route(deps, apiEvent);
  return { statusCode: result.statusCode, headers: result.headers, body: result.body };
}
```

- [ ] **Step 3: Run gates**

Run: `pnpm --filter @carlog/api typecheck && pnpm --filter @carlog/api lint && pnpm --filter @carlog/api test`
Expected: PASS (the throwing interim `enqueueImport` stub from T5 is now replaced).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/handler.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): route detached import payloads to the worker via Lambda self-invoke"
```

---

### Task 7: CDK — routes, self-invoke grant, timeout, lifecycle, TTL

**Files:**
- Modify: `infrastructure/cdk/lib/carlog-stack.ts`

**Interfaces:**
- Consumes: existing `fn`, `httpApi`, `integration`, `authorizer`, `photosBucket`, `table` variables.

- [ ] **Step 1: Raise the function timeout**

Change `timeout: Duration.seconds(29)` to:

```ts
      // 300s: detached import-worker invocations (async self-invoke) chunk large files
      // through Bedrock and need minutes. HTTP calls are still bounded by API Gateway's
      // own 30s integration cap regardless of this value.
      timeout: Duration.seconds(300),
```

- [ ] **Step 2: Grant async self-invoke**

After `photosBucket.grantReadWrite(fn);` add:

```ts
    // The import worker runs as a detached async invocation of this same function.
    // grantInvoke(fn) self-references and can cycle; a wildcard-scoped policy statement
    // on the role avoids the circular dependency.
    fn.addToRolePolicy(new PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:*`],
    }));
```

Add `PolicyStatement` to the imports: `import { PolicyStatement } from 'aws-cdk-lib/aws-iam';`

- [ ] **Step 3: S3 lifecycle for imports/ prefix**

In the `photosBucket` props, extend `lifecycleRules`:

```ts
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: Duration.days(1) },
        // Uploaded import .txt files are transient job inputs — purge after a day.
        { prefix: 'imports/', expiration: Duration.days(1) },
      ],
```

- [ ] **Step 4: DynamoDB TTL**

In the `Table` props add `timeToLiveAttribute: 'ttl',` (additive — existing rows without the attribute are unaffected).

- [ ] **Step 5: Routes**

After the existing `/import/extract` route add:

```ts
    httpApi.addRoutes({ path: '/import/presign', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/import/jobs', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/import/jobs/{jobId}', methods: [HttpMethod.GET], integration, authorizer });
```

- [ ] **Step 6: Synth + typecheck**

Run: `pnpm --filter @carlog/cdk typecheck && AWS_PROFILE=yevhenii CDK_DEFAULT_REGION=us-east-1 pnpm --filter @carlog/cdk synth > /tmp/async-import-synth.txt 2>&1; echo $?; grep -c 'import/jobs' /tmp/async-import-synth.txt; grep -c 'TimeToLiveSpecification' /tmp/async-import-synth.txt`
Expected: exit 0; `import/jobs` ≥ 1; TTL present.

- [ ] **Step 7: Commit**

```bash
git add infrastructure/cdk/lib/carlog-stack.ts
git commit -m "feat(cdk): import job routes, lambda self-invoke grant, 300s timeout, S3 lifecycle, table TTL"
```

---

### Task 8: Web — api-client, polling hooks, i18n

**Files:**
- Modify: `apps/web/src/api-client.ts`, `apps/web/src/queries.ts`, `apps/web/src/i18n/locales/en/import.json`, `apps/web/src/i18n/locales/uk/import.json`

**Interfaces:**
- Consumes: `ImportJobSchema`, type `ImportJob`, `IMPORT_FILE_MAX`, `IMPORT_INLINE_MAX` from `@carlog/contracts`; existing `request` wrapper + `uploadToS3`.
- Produces (T9 uses these exact names):
  - api-client: `presignImportTxt(token, size): Promise<{key, uploadUrl}>`, `createImportJob(token, input: {carId, text?} | {carId, s3Key?}): Promise<{jobId}>`, `getImportJob(token, carId, jobId): Promise<ImportJob>`, `latestImportJob(token, carId): Promise<ImportJob | null>` (404 → null).
  - queries: `useCreateImportJob(carId)` (mutation taking `{text?: string; file?: File}` — uploads the file first when present), `useImportJob(carId, jobId | undefined)` (query, `refetchInterval: 2500` while pending/running, disabled without jobId), `useLatestImportJob(carId, enabled)`.

- [ ] **Step 1: api-client additions**

Add to the `@carlog/contracts` import: `ImportJobSchema, type ImportJob`. Add near `extractEvents`:

```ts
const ImportPresignSchema = z.object({ key: z.string(), uploadUrl: z.string().url() });
const CreateJobResponseSchema = z.object({ jobId: z.string().uuid() });

export const presignImportTxt = (token: string, size: number): Promise<z.infer<typeof ImportPresignSchema>> =>
  request(token, '/import/presign', ImportPresignSchema, { method: 'POST', body: JSON.stringify({ size }) });

export const createImportJob = (token: string, input: { carId: string; text?: string; s3Key?: string }): Promise<{ jobId: string }> =>
  request(token, '/import/jobs', CreateJobResponseSchema, { method: 'POST', body: JSON.stringify(input) });

export const getImportJob = (token: string, carId: string, jobId: string): Promise<ImportJob> =>
  request(token, `/import/jobs/${jobId}?carId=${encodeURIComponent(carId)}`, ImportJobSchema);

export const latestImportJob = async (token: string, carId: string): Promise<ImportJob | null> => {
  try {
    return await request(token, `/import/jobs?carId=${encodeURIComponent(carId)}`, ImportJobSchema);
  } catch (e) {
    if ((e as Error).message.includes('404')) return null;
    throw e;
  }
};
```

(`z` is already imported in this file.)

- [ ] **Step 2: queries additions**

Add imports (`presignImportTxt, createImportJob, getImportJob, latestImportJob`, `uploadToS3`, and `type ImportJob` from `@carlog/contracts`), then near `useExtractEvents`:

```ts
export function useCreateImportJob(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? '';
  return useMutation({
    mutationFn: async (input: { text?: string; file?: File }) => {
      if (input.file) {
        const { key, uploadUrl } = await presignImportTxt(token, input.file.size);
        await uploadToS3(uploadUrl, input.file);
        return createImportJob(token, { carId, s3Key: key });
      }
      return createImportJob(token, { carId, text: input.text ?? '' });
    },
  });
}

export function useImportJob(carId: string, jobId: string | undefined) {
  const { accessToken } = useAuth(); const token = accessToken ?? '';
  return useQuery({
    queryKey: ['cars', carId, 'importJobs', jobId],
    queryFn: () => getImportJob(token, carId, jobId ?? ''),
    enabled: Boolean(token && carId && jobId),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'pending' || s === 'running' ? 2500 : false;
    },
  });
}

export function useLatestImportJob(carId: string, enabled: boolean) {
  const { accessToken } = useAuth(); const token = accessToken ?? '';
  return useQuery({
    queryKey: ['cars', carId, 'importJobs', 'latest'],
    queryFn: () => latestImportJob(token, carId),
    enabled: Boolean(token && carId && enabled),
    staleTime: 0,
  });
}
```

Note: TanStack Query v5 `refetchInterval` callback receives the query object; confirm the installed major (check `apps/web/package.json` — if v4, the callback signature is `(data, query) => ...`; use the form that typechecks).

- [ ] **Step 3: i18n keys**

`apps/web/src/i18n/locales/en/import.json` — add:

```json
"uploadTxt": "Upload .txt file",
"notTxt": "Please choose a plain-text .txt file.",
"fileTooLargeTxt": "That file is larger than 1 MB.",
"startImport": "Start import",
"progressChunks": "{{done}}/{{total}} parts · {{found}} events found",
"preparing": "Preparing…",
"hide": "Hide",
"startNew": "Start new import",
"resumeBanner": "An import for this car is in progress or recently finished.",
"jobFailed_extractionFailed": "We couldn't extract events from that text.",
"jobFailed_fileTooLarge": "The file is too large to process.",
"jobFailed_fileMissing": "The uploaded file could not be read.",
"jobFailed_timeBudgetExceeded": "The file was too large to finish; partial results are shown.",
"jobFailed_stale": "The import stalled. Please try again.",
"jobFailed_carMissing": "The car for this import no longer exists."
```

`apps/web/src/i18n/locales/uk/import.json` — add:

```json
"uploadTxt": "Завантажити файл .txt",
"notTxt": "Оберіть текстовий файл .txt.",
"fileTooLargeTxt": "Файл більший за 1 МБ.",
"startImport": "Почати імпорт",
"progressChunks": "{{done}}/{{total}} частин · знайдено подій: {{found}}",
"preparing": "Підготовка…",
"hide": "Сховати",
"startNew": "Почати новий імпорт",
"resumeBanner": "Імпорт для цього авто триває або нещодавно завершився.",
"jobFailed_extractionFailed": "Не вдалося виділити події з цього тексту.",
"jobFailed_fileTooLarge": "Файл завеликий для обробки.",
"jobFailed_fileMissing": "Не вдалося прочитати завантажений файл.",
"jobFailed_timeBudgetExceeded": "Файл завеликий, щоб завершити; показано часткові результати.",
"jobFailed_stale": "Імпорт зупинився. Спробуйте ще раз.",
"jobFailed_carMissing": "Автомобіль для цього імпорту більше не існує."
```

- [ ] **Step 4: Gates**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api-client.ts apps/web/src/queries.ts apps/web/src/i18n/locales/en/import.json apps/web/src/i18n/locales/uk/import.json
git commit -m "feat(web): import job client, polling hooks, and i18n keys"
```

---

### Task 9: Web — dialog: file input, progress phase, resume

**Files:**
- Modify: `apps/web/src/components/ImportEventsDialog.tsx`

**Interfaces:**
- Consumes: `useCreateImportJob`, `useImportJob`, `useLatestImportJob` (T8); existing `useCreateEvent`; `IMPORT_INLINE_MAX`, `IMPORT_FILE_MAX`, type `CandidateEvent`, `EVENT_CATEGORIES` from `@carlog/contracts`.
- Behavior contract:
  - Phases: `input` → `progress` → `review` (review/commit code stays as-is, including the partial-retry commit loop).
  - Input phase: paste box `maxLength: IMPORT_INLINE_MAX` AND an "Upload .txt file" button (hidden `<input type="file" accept=".txt,text/plain">`); client-side validation (type contains `text/plain` OR name ends `.txt`; size ≤ `IMPORT_FILE_MAX`); selected file shown by name with a clear (✕) option; "Start import" enabled when text OR file present; on submit call `createJob.mutateAsync({text?|file?})`, store `jobId`, switch to `progress`.
  - Progress phase: `useImportJob(carId, jobId)` polls; render `LinearProgress` (`variant="determinate"` when total>0 else indeterminate), the `progressChunks` line, and a `hide` button that just closes the dialog (job continues). On `status==='completed'`: seed `drafts` from `job.events` ONCE (guard with a ref or check `phase !== 'review'`) and switch to `review`. On `failed`: show `jobFailed_<error>` (fallback `errorFailed`), keep partial `job.events` reviewable when non-empty (button `addAll` with the partial count), and offer `startNew` (returns to input, clears jobId).
  - Resume: when the dialog opens (`open` transitions to true) with no active local job, `useLatestImportJob(carId, open)`; if it returns a job that is pending/running → jump to `progress` with that jobId; completed → seed review from its events; failed → show input with the failure banner. A `startNew` button in progress/review lets the user abandon a resumed job view.
  - The old `useExtractEvents` usage is REMOVED from the dialog (the sync endpoint stays server-side only).

- [ ] **Step 1: Rework the dialog** — implement the behavior contract above. The review/commit block (drafts cards, `patch`/`remove`, `onCommit` with the committed-prefix retry fix) is kept verbatim. Suggested new state: `const [jobId, setJobId] = useState<string | null>(null);` plus `const [file, setFile] = useState<File | null>(null);` and `phase: 'input' | 'progress' | 'review'`. Wire `useEffect` on `job.status` to transition phases. Reuse the existing error Alert slot for job-failure messages: `t(\`import:jobFailed_${job.error}\`, t('import:errorFailed'))`.

- [ ] **Step 2: Gates + SW guard**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web test && pnpm --filter @carlog/web build && grep -c execute-api apps/web/dist/sw.js`
Expected: all PASS; grep prints `0`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ImportEventsDialog.tsx
git commit -m "feat(web): async import dialog with txt upload, live progress, and job resume"
```

---

### Task 10: Deploy + live verification

**Files:** none (deploy + smoke only).

- [ ] **Step 1: Full gate** — `pnpm turbo run typecheck lint test` → all green.
- [ ] **Step 2: Deploy backend** — `AWS_PROFILE=yevhenii CDK_DEFAULT_REGION=us-east-1 pnpm --filter @carlog/cdk exec cdk deploy --require-approval never` → UPDATE_COMPLETE. (Reminder: synth resolves both SSM secrets via bin/carlog.ts — they exist already.)
- [ ] **Step 3: Deploy web** — `AWS_PROFILE=yevhenii ./scripts/deploy-web.sh`.
- [ ] **Step 4: Live smoke (throwaway user, then clean up + revert client to SRP-only keeping `COGNITO Google`):**
  1. Short paste job: POST /import/jobs `{carId, text:"Oil change January 2024 at 45000 km, 1200 UAH."}` → 202; poll GET → completed with 1 event.
  2. Multi-chunk file: generate a ~40KB txt (repeat maintenance lines), presign → PUT to S3 → create job with s3Key → poll: progress.total > 1, done increments, completed with events.
  3. Foreign carId → 404 on create. Both text+s3Key → 400.
  4. Latest-job query returns the finished job; job GET hides `text`/`ownerId`.
  5. Web bundle serves; SW execute-api = 0.
- [ ] **Step 5: Finish the branch** — superpowers:finishing-a-development-branch (merge to main after user confirmation).

---

## Self-Review Notes

- **Spec coverage:** caps+schemas → T1; chunker/merger → T2; job row+TTL → T3 (repo) + T7 (table TTL); worker with skip/budget/all-fail/fileMissing → T4; routes+stale guard+presign → T5; self-invoke + payload branch + loadS3Text size check → T6; CDK routes/grant/timeout/lifecycle/TTL → T7; client+polling hooks+i18n → T8; dialog file/progress/resume → T9; deploy+smoke → T10. Sync route untouched ✓ (no task modifies extract). All spec sections mapped.
- **Type consistency:** `ImportJobRecord`(T3) used by T4/T5/T6; `ImportWorkPayload`(T4) used by T5 (`enqueueImport` signature) and T6 (invoke + branch); `queryParams` added to `ApiEvent`(T5) consumed by T6 handler mapping; web fn names (T8) match T9's consumption; `IMPORT_CHUNK_SIZE`/`MAX_JOB_EVENTS`(T1) used in T4; `IMPORT_FILE_MAX`(T1) used in T6 loadS3Text + T8 client validation. Consistent.
- **Placeholder scan:** T9 Step 1 is a behavior contract rather than full JSX — deliberate: the dialog's review block must be preserved VERBATIM from the current file, and duplicating ~120 lines of existing code in the plan invites drift; the contract enumerates every state, transition, and key by exact name. All other code steps are complete.
- **Known risks flagged in-plan:** TanStack v4-vs-v5 `refetchInterval` signature (T8 note); `grantInvoke` self-reference cycle avoided via role policy (T7); handler interim stub during T5 (established pattern).
