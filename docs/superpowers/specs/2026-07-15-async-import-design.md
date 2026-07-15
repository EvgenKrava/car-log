# Async Import with .txt Support — Design

**Date:** 2026-07-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Builds on:** the live AI timeline import (`POST /import/extract`, `extractEvents` domain
use-case, `BedrockLlmProvider`, `ImportEventsDialog`), the presign upload pattern, and the
single-table nested-entity SK conventions.

## Goal

Make the import process handle big inputs: accept `.txt` files up to 1 MB (and pastes up
to 64 KB), process them **asynchronously** in chunks so nothing hits the 29s API timeout,
show live progress, and let the user close the dialog and come back. The current sync
path (10k-char cap, one Bedrock call, 29s ceiling) becomes a legacy route the dialog no
longer uses.

## Locked Decisions

| Area | Decision |
|------|----------|
| Size ceiling | Paste ≤ **64 KB** inline; `.txt` file ≤ **1 MB** via presigned S3 upload. Bigger → rejected client-side and at the API. |
| Job runner | **Self-invoking Lambda + DynamoDB job row.** `POST /import/jobs` creates the job row and async-invokes the SAME Lambda (`InvocationType=Event`) with a job payload; that detached invocation (up to 15 min) processes chunks and updates the row. No queue, no second Lambda, no Step Functions. |
| Input paths | BOTH paste and `.txt` upload, one backend path: pasted text goes inline in the create-job request; files go S3-first via a `text/plain` presign, then the job references the s3Key. |
| Progress UX | **Close-able dialog + resumable job.** Polling progress bar (chunks done/total, events found); user may close the dialog and keep using the app; reopening the import dialog for that car shows the latest running/finished job. |
| Chunking | ~10k-char chunks split on line boundaries (never mid-line unless a single line exceeds the max). Sequential per-chunk Bedrock calls via the existing `extractEvents` use-case. |
| Result cap | ≤ **500** candidate events per job (`MAX_JOB_EVENTS`). |
| Job retention | DynamoDB TTL 24 h on job rows; S3 `imports/` objects lifecycle-deleted after 1 day. |
| Sync route | `POST /import/extract` remains deployed but unused by the dialog (removal is a later cleanup — no breaking change mid-transition). |

## Architecture & Data Flow

```
Dialog: paste (≤64KB inline) or .txt file (≤1MB → POST /import/presign → S3 PUT)
  → POST /import/jobs { carId, text? | s3Key? }
      → ownership check (404 before anything else)
      → job row: PK=USER#<ownerId>, SK=CAR#<carId>#IMPORT#<jobId>, status=pending, TTL 24h
      → async self-invoke same Lambda: { jobType:'import', ownerId, carId, jobId }
      ← 202 { jobId }

Worker invocation (same Lambda, detached, ≤15 min):
  → load text (inline from job row, or GetObject from S3)
  → chunkText(text, ~10_000)                       [pure domain helper]
  → status=running, progress {done:0,total:N,found:0}
  → per chunk: extractEvents(chunk, provider, ctx)  [existing domain use-case, unchanged]
      success → append candidates (≤500 total), progress.done++, found+=k
      failure (shapeless twice / Bedrock down twice) → skippedChunks++, continue
  → status=completed  (ALL chunks failed → status=failed, error='extractionFailed')

Web: poll GET /import/jobs/{jobId} every ~2.5s while the dialog is open
  → running:   progress bar + "N/M chunks · K events found" + Hide button
  → completed: the SAME editable review list as today → commit via existing POST /events
  → reopening the dialog: GET /import/jobs?carId=… returns the latest job → resume view
```

**Unchanged:** the pure `extractEvents` use-case, the Bedrock adapter (called per chunk),
the review/commit path (existing `useCreateEvent` loop with the partial-retry fix), auth,
the car-list SK whitelist (job SK has 4 segments — already excluded).

**Worker placement:** the chunk-orchestration logic is a testable function in `apps/api`
taking ports (job store, text loader, LlmProvider); the Lambda handler routes
`jobType:'import'` payloads to it (detached invocations bypass API Gateway, so the
handler distinguishes an async job payload from an HTTP event by shape).

**Sizing:** 1 MB ≈ ~100 chunks worst case; sequential at ~5-10s/chunk fits the 15-min
window. The worker checks remaining time via the Lambda context deadline and, when
< 60s remain, marks the job `failed` with `error='timeBudgetExceeded'` (partial results
kept and visible) — no zombie jobs.

**Item-size guard:** candidates are stored on the job row; at ~500 compact events the row
stays under DynamoDB's 400 KB item limit. The worker enforces the 500 cap; if the encoded
row would still exceed the limit it stops appending and completes with what fits (the cap
makes this practically unreachable — the guard is a safety net, not a feature).

## Contracts (`packages/contracts/src/import.ts` additions)

```ts
export const IMPORT_INLINE_MAX = 64_000;
export const IMPORT_FILE_MAX = 1_048_576;
export const MAX_JOB_EVENTS = 500;

export const CreateImportJobRequestSchema = z.object({
  carId: z.string().uuid(),
  text: z.string().min(1).max(IMPORT_INLINE_MAX).optional(),
  s3Key: z.string().min(1).optional(),
}).refine((v) => Boolean(v.text) !== Boolean(v.s3Key), { message: 'exactly one of text or s3Key' });

export const ImportJobStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);

export const ImportJobSchema = z.object({
  id: z.string().uuid(),
  carId: z.string().uuid(),
  status: ImportJobStatusSchema,
  progress: z.object({ done: z.number().int().min(0), total: z.number().int().min(0), found: z.number().int().min(0) }),
  events: z.array(CandidateEventSchema).max(MAX_JOB_EVENTS).default([]),
  skippedChunks: z.number().int().min(0).default(0),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type ImportJob = z.infer<typeof ImportJobSchema>;
```

Presign request/response for the txt upload mirror the existing photo presign shapes
(`contentType: 'text/plain'`, size ≤ `IMPORT_FILE_MAX`), targeting the photos bucket
under an `imports/<ownerId>/<uuid>.txt` key with a 1-day lifecycle rule.

## REST Surface (additions)

```
POST /import/presign        → { key, uploadUrl }          (txt, ≤1MB)
POST /import/jobs           → 202 { jobId }
GET  /import/jobs/{jobId}   → ImportJob                   (404 if not owner's)
GET  /import/jobs?carId=…   → latest ImportJob for car or 404 (resume view)
```

## Domain Additions (pure, unit-tested)

- `chunkText(text: string, maxLen: number): string[]` — split on line boundaries; a
  single line longer than maxLen is hard-split; no empty chunks; order preserved.
- `mergeCandidates(lists: CandidateEvent[][], cap: number): CandidateEvent[]` — flat
  merge preserving order, truncated at cap.

Chunk orchestration (Dynamo/S3 side effects) stays in `apps/api` behind ports.

## Error Handling

| Failure | Behavior |
|---|---|
| Both/neither of text+s3Key; text >64KB | 400 (Zod) before job creation |
| Foreign/missing carId | 404, no job created |
| S3 object missing or >1MB at worker read | job → `failed`, `error='fileTooLarge'` (or `'fileMissing'`) |
| One chunk fails (existing retry inside extractEvents exhausted) | `skippedChunks++`, continue |
| ALL chunks fail | job → `failed`, `error='extractionFailed'` |
| Lambda deadline approaching (<60s) | job → `failed`, `error='timeBudgetExceeded'`, partial events kept |
| Worker crash (job stuck `running`/`pending`) | GET returns it as `failed` when `createdAt` older than 20 min (stale-job guard, computed at read) |
| Job not found | 404 |

## CDK Changes

- Routes: `POST /import/presign`, `POST /import/jobs`, `GET /import/jobs/{jobId}`,
  `GET /import/jobs` (query) → existing Lambda integration + authorizer.
- Lambda: grant `lambda:InvokeFunction` on itself (async self-invoke). Timeout for the
  HTTP-facing path stays 29s; the SAME function invoked async runs with the function
  timeout — raise the function timeout to **900s**? No: one function has one timeout, and
  API Gateway's own 30s integration cap bounds HTTP calls regardless of function timeout.
  So: function timeout → **300s** (5 min, covers ~30 chunks) is the v1 setting; the
  worker's deadline guard handles the rest. (1 MB worst case may exceed 5 min — the guard
  fails the job cleanly with partial results; raise later if real files demand it.)
- S3: allow `text/plain` puts under `imports/` prefix + 1-day lifecycle rule on that
  prefix (photos bucket reused).
- DynamoDB: enable TTL on a `ttl` attribute (additive; existing rows unaffected).

## Web Changes

- `ImportEventsDialog`: input phase gains "Upload .txt file" (validate type/size
  client-side) alongside the paste box (maxLength raised to 64k). "Start import" creates
  the job (uploading to S3 first when a file was chosen) and switches to a progress
  phase (poll every 2.5s; MUI LinearProgress; "N/M chunks · K events found"; Hide
  button). Completed → existing review phase. Failed → translated reason, text/file
  preserved for retry.
- Resume: opening the dialog checks `GET /import/jobs?carId=` and, if a job exists
  (running or completed <24h), shows it instead of the blank input (with a "Start new
  import" escape).
- Polling via TanStack Query `refetchInterval` while status is pending/running.
- i18n (`import` namespace, EN+UK): `uploadTxt`, `fileTooLargeTxt`, `notTxt`,
  `startImport`, `progressChunks` ("{{done}}/{{total}} chunks · {{found}} events"),
  `hide`, `startNew`, `jobFailed_extractionFailed`, `jobFailed_fileTooLarge`,
  `jobFailed_fileMissing`, `jobFailed_timeBudgetExceeded`, `resumeBanner`.

## Testing

- **Domain:** `chunkText` (line-boundary splits, oversize single line, exact-fit, empty
  input, order) + `mergeCandidates` (cap, order) unit tests.
- **Contracts:** CreateImportJobRequest XOR text/s3Key, size bounds; ImportJobSchema
  defaults.
- **API/router:** in-memory job repo + fake provider + fake text loader: create→202 &
  job row pending; worker function processes 3 chunks → completed with merged events;
  per-chunk failure → skippedChunks accounting; all-fail → failed; ownership 404;
  stale-running → failed at read; query-latest returns newest.
- **Adapter/self-invoke:** not unit-tested (integration boundary) — live smoke.
- **Live smoke:** short paste (1 chunk) end-to-end; multi-chunk .txt upload with visible
  progress; close+reopen dialog resumes; commit events to timeline.

## Scope Guard (YAGNI)

Out of scope: PDF/CSV/image inputs, SQS/Step Functions, multi-file jobs, job
cancellation, job history list UI (only latest-per-car resume), per-user quotas,
websocket push (polling suffices), dedup of re-imported events.

## Files (anticipated)

```
packages/contracts/src/import.ts                MODIFY  job schemas + caps
packages/contracts/src/import.test.ts           MODIFY  new schema tests
packages/domain/src/chunk-text.ts(+test)        CREATE  pure chunker
packages/domain/src/merge-candidates.ts(+test)  CREATE  pure merger (or fold into chunk-text module)
packages/domain/src/index.ts                    MODIFY  exports
apps/api/src/import-job-repository.ts           CREATE  port + Dynamo impl + in-memory fake
apps/api/src/import-job-routes.ts               CREATE  presign/create/get/query routes
apps/api/src/import-worker.ts                   CREATE  testable chunk orchestration (ports)
apps/api/src/handler.ts                         MODIFY  route async job payloads to worker; self-invoke client
apps/api/src/router.ts                          MODIFY  wire routes + deps
apps/api/src/errors.ts                          MODIFY  (reuse existing; new typed errors only if needed)
infrastructure/cdk/lib/carlog-stack.ts          MODIFY  routes, self-invoke grant, timeout 300s, S3 lifecycle, TTL
apps/web/src/api-client.ts                      MODIFY  presignImportTxt, createImportJob, getImportJob, latestImportJob
apps/web/src/queries.ts                         MODIFY  useImportJob (polling), useCreateImportJob, useLatestImportJob
apps/web/src/components/ImportEventsDialog.tsx  MODIFY  file input, progress phase, resume view
apps/web/src/i18n/locales/{en,uk}/import.json   MODIFY  new keys
```