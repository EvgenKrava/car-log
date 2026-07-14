# Batch (Multi-File) Upload — Design

**Date:** 2026-07-14
**Status:** Approved (brainstorming) → ready for implementation plan
**Builds on:** the deployed photo (PhotoGallery) + proof (ProofList) upload flows.

## Goal

Let users select and upload **multiple files at once** in both the car PhotoGallery
and the event ProofList (currently one file at a time). Uploads run 3-at-a-time,
validated up front against the per-car/per-event cap + type/size, with per-file
status reporting. Frontend-only; no backend/CDK change (uploads already go
direct-to-S3 per file).

## Locked Decisions

| Area | Decision |
|------|----------|
| Surfaces | BOTH car photos (PhotoGallery) and event proofs (ProofList), via a shared hook |
| Concurrency | Bounded pool: max **3** concurrent uploads (respects the API-GW 20 r/s throttle) |
| Cap + failures | Validate the whole batch up front (cap + type/size); upload accepted files; per-file reporting; one file's failure doesn't stop the others |
| Progress UX | Per-file status list (queued/uploading/done/failed/skipped) + overall "N of M" count |
| Structure | Shared `useBatchUpload` hook + pure `planBatch` helper + shared `BatchUploadStatus` component; galleries are thin consumers |

## Layer 1 — `planBatch` pure helper (the testable core)

`apps/web/src/lib/batch-plan.ts`:

```ts
export type BatchItemPlan =
  | { file: File; status: 'accepted' }
  | { file: File; status: 'skipped'; reasonKey: string; params?: Record<string, unknown> };

export function planBatch(
  files: File[],
  remaining: number,
  validateOne: (f: { type: string; size: number }, countSoFar: number) => { key: string; params?: Record<string, unknown> } | null,
): BatchItemPlan[];
```

Logic, in file order: for each file, run `validateOne({type,size}, acceptedSoFar)` —
if it returns an error, `skipped` with that `{reasonKey, params}`; else if
`acceptedSoFar >= remaining`, `skipped` with the over-cap reason key (the same key
the validator uses at the cap, e.g. `photos:proofTooMany`/`event:proofTooMany` with
`{max}` — passing `countSoFar = remaining` makes `validateOne` itself emit the cap
error, so we reuse it rather than hardcode); else `accepted` and increment
`acceptedSoFar`. Reuses `validatePhotoFile`/`validateAttachmentFile` UNCHANGED. Pure →
fully unit-tested.

## Layer 2 — `useBatchUpload` hook + concurrency pool

`apps/web/src/lib/use-batch-upload.ts`:

```ts
export type UploadState = 'queued' | 'uploading' | 'done' | 'failed' | 'skipped';
export type BatchItem = { id: string; name: string; state: UploadState; reasonKey?: string; params?: Record<string, unknown> };

export function useBatchUpload(opts: {
  upload: (file: File) => Promise<void>;
  validateOne: (f: { type: string; size: number }, count: number) => { key: string; params?: Record<string, unknown> } | null;
  remaining: () => number;
  onComplete: () => void;
}): { items: BatchItem[]; running: boolean; start: (files: File[]) => void; reset: () => void };
```

- `start(files)` → `planBatch(files, remaining(), validateOne)` → seed `items`
  (accepted→`queued`, skipped→`skipped`+reason). `remaining()` read at start (not stale).
- **Concurrency-limited pool of 3:** N=3 workers each loop pulling the next `queued`
  item off a shared index, set `uploading`, `await upload(file)`, set `done` (or
  `failed` on throw), until drained. A failure marks only that item; others continue.
- On drain: call `onComplete()` **once** (invalidate the gallery query → grid refreshes),
  `running=false`.
- `reset()` clears `items`.
- The async pool is thin glue over the tested `planBatch`; not separately unit-tested.

## Layer 3 — Gallery integration + shared status UI

- `apps/web/src/components/ui/BatchUploadStatus.tsx`: renders the per-file list (name +
  state icon: queued / uploading spinner / done check / failed / skipped-with-translated-reason)
  + an overall `t(...batchUploading, {done,total})` line; dismissible (`reset`) when not running.
- **PhotoGallery.tsx:** file input gains `multiple`; `onChange` → `start(Array.from(files))`;
  wire `useBatchUpload({ upload: (f)=>uploadPhoto(token,carId,f) via the mutation, validateOne: validatePhotoFile, remaining: () => MAX_PHOTOS_PER_CAR - (photos?.length ?? 0), onComplete: invalidate ['cars',carId,'photos'] })`. Render `<BatchUploadStatus/>`. Add button disabled while `running`. The old single-file error Alert is replaced by the status list.
- **ProofList.tsx:** same wiring with `uploadProof`, `validateAttachmentFile`,
  `remaining: () => MAX_PROOFS_PER_EVENT - (proofs?.length ?? 0)`, proofs query key.
- Single-file path is removed — both galleries go through `useBatchUpload` (a 1-file
  batch is the same path).
- **i18n (EN + UK, in the `photos` and `event` namespaces the galleries already use):**
  add `batchUploading` ("Uploading {{done}} of {{total}}…"), `batchDone`, and state labels
  `stateQueued`/`stateUploading`/`stateDone`/`stateFailed`/`stateSkipped`. Skipped/failed
  rows show translated reasons via the existing cap/type/size keys. Keep the current
  upload-flow: the hook's `upload` uses the existing `useUploadPhoto`/`useUploadProof`
  mutations (or their underlying api-client fns bound to token) so nothing about the
  presign→PUT→confirm path changes.

## Testing

- **Vitest:** `planBatch` — valid mix all accepted; over-cap truncation (remaining=2, 5
  picked → 2 accepted + 3 skipped over-cap); invalid type/size skipped with the right
  key; empty input → []; all-invalid → all skipped. (Reuses the real
  validatePhotoFile/validateAttachmentFile as `validateOne` in tests, or a stub.)
- Existing validator tests unchanged.
- Async pool + components: typecheck + lint + build gates; live smoke test.
- SW guard: `grep -c execute-api dist/sw.js == 0` after build.

## Verification (definition of done)

Frontend-only, **web-only deploy** (no cdk deploy). On the deployed app:
1. Select multiple photos on a car → they upload (≤3 concurrent), per-file status shows,
   grid fills in as each completes.
2. Select more than the remaining cap → excess rows marked "limit reached", the rest
   upload.
3. Event proofs: select a mix of images + a PDF → all upload with correct rendering.
4. Force a failure (e.g. go offline mid-batch) → only that file marked failed; others OK.
5. EN⇄UK translates the status UI and skip/fail reasons.

## Scope Guard (YAGNI)

Out of scope: drag-and-drop, client-side image resize/compression, reordering,
resumable/chunked uploads, a backend batch endpoint (uploads stay per-file
direct-to-S3), and any backend/CDK change.

## Parallel-safety

Every file here is disjoint from the concurrent Google-signin feature (that = auth
screens + amplify + CDK; this = photo/proof galleries + new `lib/` helpers + i18n
`photos`/`event` namespaces). Google-signin touches `auth.json`; this touches
`photos`/`event` locale files — no locale collision either. The two worktrees won't
conflict at merge.

## Files (anticipated)

```
apps/web/src/lib/batch-plan.ts / batch-plan.test.ts     CREATE  planBatch pure helper + tests
apps/web/src/lib/use-batch-upload.ts                    CREATE  hook + concurrency pool
apps/web/src/components/ui/BatchUploadStatus.tsx        CREATE  per-file status list UI
apps/web/src/components/PhotoGallery.tsx                MODIFY  multiple input + useBatchUpload
apps/web/src/components/ProofList.tsx                   MODIFY  multiple input + useBatchUpload
apps/web/src/i18n/locales/{en,uk}/photos.json           MODIFY  batch status keys
apps/web/src/i18n/locales/{en,uk}/event.json            MODIFY  batch status keys
```
