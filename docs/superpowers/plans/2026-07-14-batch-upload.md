# Batch (Multi-File) Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users select and upload multiple files at once in the car PhotoGallery and event ProofList — 3-at-a-time, validated up front against the cap + type/size, with per-file status reporting.

**Architecture:** A pure `planBatch` helper decides per-file accepted/skipped; a `useBatchUpload` hook runs a 3-concurrency pool over the accepted files and reports per-file state; a shared `BatchUploadStatus` component renders it. PhotoGallery and ProofList become thin consumers (multi-select input + the hook). Frontend-only; the presign→PUT→confirm path per file is unchanged.

**Tech Stack:** React 18 + MUI v6, TanStack Query, react-i18next, Vitest. Reuses existing `uploadPhoto`/`uploadProof` (via `useUploadPhoto`/`useUploadProof`), `validatePhotoFile`/`validateAttachmentFile`, and the `photos`/`event` i18n namespaces.

## Global Constraints

- Frontend-only. NO backend/CDK/contracts/domain change. Uploads stay per-file direct-to-S3.
- Strict TS, never `any`. MUI only. Extensionless imports. Every user-facing string via `t()`, EN + UK.
- Concurrency pool cap = **3** concurrent uploads.
- Reuse the EXISTING validators (`validatePhotoFile`, `validateAttachmentFile`) unchanged — do NOT modify them. They return `{ key: string; params?: Record<string, unknown> } | null` and already emit the over-cap key when `count >= max`.
- Caps: `MAX_PHOTOS_PER_CAR` (photos), `MAX_PROOFS_PER_EVENT` (proofs), from `@carlog/contracts`.
- Invalidate the gallery query ONCE at batch end (not per file).
- SW must not cache API: after web build `grep -c execute-api dist/sw.js == 0`.
- Conventional commits; NO co-authorship trailers.
- **Parallel-safety:** this feature is being built in a worktree concurrently with the Google-signin feature. Touch ONLY the files listed below (photo/proof galleries, new `lib/` helpers, the `photos`/`event` locale namespaces). Do NOT touch `auth*`, `main.tsx`, `amplify.ts`, or `auth.json` — those belong to the other worktree.

## File Structure

```
apps/web/src/lib/batch-plan.ts / batch-plan.test.ts     CREATE  planBatch pure helper + tests (T1)
apps/web/src/lib/use-batch-upload.ts                    CREATE  hook + 3-concurrency pool (T2)
apps/web/src/components/ui/BatchUploadStatus.tsx        CREATE  per-file status list UI (T2)
apps/web/src/i18n/locales/{en,uk}/photos.json           MODIFY  batch status keys (T3)
apps/web/src/i18n/locales/{en,uk}/event.json            MODIFY  batch status keys (T3)
apps/web/src/components/PhotoGallery.tsx                MODIFY  multiple input + useBatchUpload (T3)
apps/web/src/components/ProofList.tsx                   MODIFY  multiple input + useBatchUpload (T4)
```

Order: planBatch (1) → hook + status UI (2) → PhotoGallery + i18n (3) → ProofList (4). (No separate deploy task — the parallel run's merge/deploy is handled by the controller alongside the Google feature.)

---

### Task 1: `planBatch` pure helper

**Files:**
- Create: `apps/web/src/lib/batch-plan.ts`, `apps/web/src/lib/batch-plan.test.ts`

**Interfaces:**
- Produces:
  - `type BatchItemPlan = { file: File; status: 'accepted' } | { file: File; status: 'skipped'; reasonKey: string; params?: Record<string, unknown> }`
  - `planBatch(files: File[], remaining: number, validateOne: (f: { type: string; size: number }, countSoFar: number) => { key: string; params?: Record<string, unknown> } | null): BatchItemPlan[]`

- [ ] **Step 1: Write the failing test — `apps/web/src/lib/batch-plan.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { planBatch } from './batch-plan';

// A stub validator: rejects non-image types and files > 10, and emits an over-cap
// key when countSoFar >= 3 (mimics the real validators' shape).
const CAP = 3;
const validateOne = (f: { type: string; size: number }, count: number) => {
  if (count >= CAP) return { key: 'tooMany', params: { max: CAP } };
  if (!f.type.startsWith('image/')) return { key: 'badType' };
  if (f.size > 10) return { key: 'tooLarge' };
  return null;
};
const file = (name: string, type = 'image/jpeg', size = 5): File =>
  ({ name, type, size } as unknown as File);

describe('planBatch', () => {
  it('accepts all valid files under the cap', () => {
    const plan = planBatch([file('a'), file('b')], CAP, validateOne);
    expect(plan.map((p) => p.status)).toEqual(['accepted', 'accepted']);
  });
  it('truncates over the remaining cap', () => {
    const plan = planBatch([file('a'), file('b'), file('c'), file('d'), file('e')], 2, validateOne);
    expect(plan.filter((p) => p.status === 'accepted')).toHaveLength(2);
    const skipped = plan.filter((p) => p.status === 'skipped');
    expect(skipped).toHaveLength(3);
    expect(skipped[0]).toMatchObject({ status: 'skipped', reasonKey: 'tooMany' });
  });
  it('skips invalid type/size but still accepts valid ones', () => {
    const plan = planBatch([file('a'), file('bad', 'application/zip'), file('big', 'image/png', 999)], CAP, validateOne);
    expect(plan[0].status).toBe('accepted');
    expect(plan[1]).toMatchObject({ status: 'skipped', reasonKey: 'badType' });
    expect(plan[2]).toMatchObject({ status: 'skipped', reasonKey: 'tooLarge' });
  });
  it('returns [] for no files', () => {
    expect(planBatch([], CAP, validateOne)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/web test`
Expected: FAIL — cannot resolve `./batch-plan`.

- [ ] **Step 3: Create `apps/web/src/lib/batch-plan.ts`**

```ts
export type BatchItemPlan =
  | { file: File; status: 'accepted' }
  | { file: File; status: 'skipped'; reasonKey: string; params?: Record<string, unknown> };

export function planBatch(
  files: File[],
  remaining: number,
  validateOne: (f: { type: string; size: number }, countSoFar: number) => { key: string; params?: Record<string, unknown> } | null,
): BatchItemPlan[] {
  let accepted = 0;
  return files.map((file) => {
    // Pass the running accepted count so the validator itself emits the over-cap
    // error once we've accepted `remaining` files (reuses the validator's cap logic).
    const err = validateOne({ type: file.type, size: file.size }, accepted >= remaining ? remaining : accepted);
    if (accepted >= remaining) {
      const capErr = validateOne({ type: file.type, size: file.size }, remaining);
      return { file, status: 'skipped', reasonKey: capErr?.key ?? 'tooMany', params: capErr?.params };
    }
    if (err) return { file, status: 'skipped', reasonKey: err.key, params: err.params };
    accepted += 1;
    return { file, status: 'accepted' };
  });
}
```

Note: the cap check comes first (a file over the remaining cap is `skipped` with the cap reason even if otherwise valid); an accepted slot only decrements when a file passes validation. The `validateOne(..., remaining)` call reuses the real validators' own cap message so `planBatch` never hardcodes the over-cap key.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @carlog/web test`
Expected: PASS (existing web tests + 4 new planBatch tests).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/batch-plan.ts apps/web/src/lib/batch-plan.test.ts
git commit -m "feat(web): add planBatch helper for multi-file upload validation"
```

---

### Task 2: `useBatchUpload` hook + `BatchUploadStatus` component

**Files:**
- Create: `apps/web/src/lib/use-batch-upload.ts`, `apps/web/src/components/ui/BatchUploadStatus.tsx`

**Interfaces:**
- Consumes: `planBatch`, `BatchItemPlan` from `./batch-plan` (Task 1).
- Produces:
  - `type UploadState = 'queued' | 'uploading' | 'done' | 'failed' | 'skipped'`
  - `type BatchItem = { id: string; name: string; state: UploadState; reasonKey?: string; params?: Record<string, unknown> }`
  - `useBatchUpload(opts: { upload: (file: File) => Promise<void>; validateOne: (f: { type: string; size: number }, count: number) => { key: string; params?: Record<string, unknown> } | null; remaining: () => number; onComplete: () => void }): { items: BatchItem[]; running: boolean; start: (files: File[]) => void; reset: () => void }`
  - `BatchUploadStatus({ items, running }: { items: BatchItem[]; running: boolean })`

- [ ] **Step 1: Create `apps/web/src/lib/use-batch-upload.ts`**

```ts
import { useCallback, useRef, useState } from 'react';
import { planBatch } from './batch-plan';

export type UploadState = 'queued' | 'uploading' | 'done' | 'failed' | 'skipped';
export type BatchItem = {
  id: string;
  name: string;
  state: UploadState;
  reasonKey?: string;
  params?: Record<string, unknown>;
};

const CONCURRENCY = 3;

type Opts = {
  upload: (file: File) => Promise<void>;
  validateOne: (f: { type: string; size: number }, count: number) => { key: string; params?: Record<string, unknown> } | null;
  remaining: () => number;
  onComplete: () => void;
};

export function useBatchUpload({ upload, validateOne, remaining, onComplete }: Opts) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const seq = useRef(0);

  const setState = (id: string, state: UploadState) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, state } : it)));

  const start = useCallback((files: File[]) => {
    if (!files.length) return;
    const plan = planBatch(files, remaining(), validateOne);
    const seeded: BatchItem[] = plan.map((p) => ({
      id: `${seq.current++}-${p.file.name}`,
      name: p.file.name,
      state: p.status === 'accepted' ? 'queued' : 'skipped',
      reasonKey: p.status === 'skipped' ? p.reasonKey : undefined,
      params: p.status === 'skipped' ? p.params : undefined,
    }));
    setItems(seeded);

    const queue = plan
      .map((p, i) => ({ p, id: seeded[i].id }))
      .filter((x) => x.p.status === 'accepted');
    if (!queue.length) return;

    setRunning(true);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const idx = cursor++;
        if (idx >= queue.length) return;
        const { p, id } = queue[idx];
        setState(id, 'uploading');
        try {
          await upload(p.file);
          setState(id, 'done');
        } catch {
          setState(id, 'failed');
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()))
      .then(() => {
        setRunning(false);
        onComplete();
      });
  }, [upload, validateOne, remaining, onComplete]);

  const reset = useCallback(() => setItems([]), []);

  return { items, running, start, reset };
}
```

Note: `remaining()` is read at `start` (fresh). The query is invalidated once via `onComplete()` after all workers drain. `cursor` is a shared closure index so the 3 workers never exceed 3 in flight and never double-process an item.

- [ ] **Step 2: Create `apps/web/src/components/ui/BatchUploadStatus.tsx`**

```tsx
import { Box, CircularProgress, List, ListItem, ListItemIcon, ListItemText, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import RemoveCircleIcon from '@mui/icons-material/RemoveCircle';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { useTranslation } from 'react-i18next';
import type { BatchItem } from '../../lib/use-batch-upload';

export function BatchUploadStatus({ items, running }: { items: BatchItem[]; running: boolean }) {
  const { t } = useTranslation(['common']);
  if (!items.length) return null;

  const total = items.filter((i) => i.state !== 'skipped').length;
  const done = items.filter((i) => i.state === 'done' || i.state === 'failed').length;

  const icon = (i: BatchItem) => {
    if (i.state === 'uploading') return <CircularProgress size={18} />;
    if (i.state === 'done') return <CheckCircleIcon color="success" fontSize="small" />;
    if (i.state === 'failed') return <ErrorIcon color="error" fontSize="small" />;
    if (i.state === 'skipped') return <RemoveCircleIcon color="disabled" fontSize="small" />;
    return <ScheduleIcon color="disabled" fontSize="small" />;
  };

  return (
    <Box sx={{ mb: 2, border: 1, borderColor: 'divider', borderRadius: 2, p: 1 }}>
      {running ? (
        <Typography variant="body2" sx={{ mb: 0.5 }}>{t('common:batchUploading', { done, total })}</Typography>
      ) : null}
      <List dense disablePadding>
        {items.map((i) => (
          <ListItem key={i.id} disableGutters>
            <ListItemIcon sx={{ minWidth: 32 }}>{icon(i)}</ListItemIcon>
            <ListItemText
              primary={i.name}
              secondary={i.reasonKey ? t(i.reasonKey, i.params) : undefined}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}
```

Note: `reasonKey` values are fully-qualified namespace keys (e.g. `photos:proofTooMany` / `event:proofTooMany`) surfaced by the validators, so `t(i.reasonKey)` resolves without a namespace prefix. `batchUploading` lives in `common`.

- [ ] **Step 3: Add the `batchUploading` key to `common` (en + uk)**

`apps/web/src/i18n/locales/en/common.json` — add `"batchUploading": "Uploading {{done}} of {{total}}…"`.
`apps/web/src/i18n/locales/uk/common.json` — add `"batchUploading": "Завантаження {{done}} з {{total}}…"`.

- [ ] **Step 4: Typecheck + lint + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build`
Expected: all PASS (hook + component compile; not yet used — fine).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/use-batch-upload.ts apps/web/src/components/ui/BatchUploadStatus.tsx apps/web/src/i18n/locales/en/common.json apps/web/src/i18n/locales/uk/common.json
git commit -m "feat(web): add useBatchUpload hook (3-concurrency pool) and BatchUploadStatus UI"
```

---

### Task 3: PhotoGallery multi-file upload

**Files:**
- Modify: `apps/web/src/components/PhotoGallery.tsx`
- Modify: `apps/web/src/i18n/locales/en/photos.json`, `apps/web/src/i18n/locales/uk/photos.json`

**Interfaces:**
- Consumes: `useBatchUpload` + `BatchUploadStatus` (Task 2); existing `usePhotos`/`useUploadPhoto`/`useDeletePhoto`, `validatePhotoFile`, `MAX_PHOTOS_PER_CAR`.

- [ ] **Step 1: Rewrite the upload wiring in `apps/web/src/components/PhotoGallery.tsx`**

Replace the single-file `onPick` + `error`/`upload.isPending` UI with the batch hook. New imports + component body (keep the grid, lightbox, delete, and loading/error/empty states unchanged):

```tsx
import { useRef } from 'react';
import {
  Box, Button, Dialog, IconButton, ImageList, ImageListItem, Stack, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import DeleteIcon from '@mui/icons-material/Delete';
import { useQueryClient } from '@tanstack/react-query';
import { MAX_PHOTOS_PER_CAR } from '@carlog/contracts';
import { usePhotos, useUploadPhoto, useDeletePhoto } from '../queries';
import { validatePhotoFile } from '../lib/validate-photo';
import { useBatchUpload } from '../lib/use-batch-upload';
import { ConfirmDialog } from './ConfirmDialog';
import { StatusView } from './ui/StatusView';
import { BatchUploadStatus } from './ui/BatchUploadStatus';

export function PhotoGallery({ carId }: { carId: string }) {
  const { t } = useTranslation(['photos', 'common']);
  const { data: photos, isLoading, isError } = usePhotos(carId);
  const upload = useUploadPhoto(carId);
  const del = useDeletePhoto(carId);
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const batch = useBatchUpload({
    upload: (file) => upload.mutateAsync(file),
    validateOne: validatePhotoFile,
    remaining: () => MAX_PHOTOS_PER_CAR - (photos?.length ?? 0),
    onComplete: () => { void qc.invalidateQueries({ queryKey: ['cars', carId, 'photos'] }); },
  });

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    batch.start(files);
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h6">{t('photos:title')}</Typography>
        <Button startIcon={<AddPhotoAlternateIcon />} onClick={() => inputRef.current?.click()} disabled={batch.running}>
          {t('photos:add')}
        </Button>
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={onPick} />
      </Stack>
      <BatchUploadStatus items={batch.items} running={batch.running} />

      {isLoading ? (
        <StatusView state="loading" />
      ) : isError ? (
        <StatusView state="error" message={t('photos:loadError')} />
      ) : !photos?.length ? (
        <Typography color="text.secondary">{t('photos:empty')}</Typography>
      ) : (
        <ImageList cols={3} gap={8} sx={{ m: 0 }}>
          {photos.map((p) => (
            <ImageListItem key={p.id} sx={{ position: 'relative', borderRadius: 2, overflow: 'hidden' }}>
              <img
                src={p.url} alt="Car photo" loading="lazy"
                style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', cursor: 'pointer' }}
                onClick={() => setLightbox(p.url)}
              />
              <IconButton
                size="small" aria-label="Delete photo"
                onClick={() => setToDelete(p.id)}
                sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'rgba(0,0,0,0.5)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' } }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </ImageListItem>
          ))}
        </ImageList>
      )}

      <Dialog open={Boolean(lightbox)} onClose={() => setLightbox(null)} maxWidth="md">
        {lightbox ? <img src={lightbox} alt="Car photo" style={{ width: '100%', display: 'block' }} /> : null}
      </Dialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title={t('photos:deleteTitle')}
        message={t('photos:deleteConfirm')}
        confirmLabel={t('common:delete')}
        onConfirm={async () => { if (toDelete) await del.mutateAsync(toDelete); setToDelete(null); }}
        onClose={() => setToDelete(null)}
        loading={del.isPending}
      />
    </Box>
  );
}
```

Add `useState` to the react import at the top: `import { useRef, useState } from 'react';` (the snippet uses both).

- [ ] **Step 2: (photos i18n)** No NEW `photos` keys are strictly required — the over-cap/type/size reason keys (`proofTooMany`/`tooMany`, `notImage`/`proofBadType`, `tooLarge`) already exist and are what `validatePhotoFile` returns. Verify the keys `validatePhotoFile` emits exist in `photos.json` (they were added when photo validation was built). If `validatePhotoFile` returns keys in the `photos` namespace that are missing, add them; otherwise no change. (Batch summary string `batchUploading` was added to `common` in Task 2.)

Run to confirm the keys resolve: `grep -oE "'[a-z]+:[a-zA-Z]+'" apps/web/src/lib/validate-photo.ts` and confirm each exists in `apps/web/src/i18n/locales/en/photos.json`.

- [ ] **Step 3: Typecheck + lint + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/PhotoGallery.tsx apps/web/src/i18n/locales/en/photos.json apps/web/src/i18n/locales/uk/photos.json
git commit -m "feat(web): multi-file batch upload in PhotoGallery"
```

---

### Task 4: ProofList multi-file upload

**Files:**
- Modify: `apps/web/src/components/ProofList.tsx`

**Interfaces:**
- Consumes: `useBatchUpload` + `BatchUploadStatus` (Task 2); existing `useProofs`/`useUploadProof`/`useDeleteProof`, `validateAttachmentFile`, `MAX_PROOFS_PER_EVENT`.

- [ ] **Step 1: Rewrite the upload wiring in `apps/web/src/components/ProofList.tsx`**

Mirror the PhotoGallery change: replace the single-file `onPick` + inline error/spinner with the batch hook + `BatchUploadStatus`. Keep the proof thumbnail/PDF-card rendering, lightbox, and delete unchanged. The wiring:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { MAX_PROOFS_PER_EVENT } from '@carlog/contracts';
import { useBatchUpload } from '../lib/use-batch-upload';
import { BatchUploadStatus } from './ui/BatchUploadStatus';
import { validateAttachmentFile } from '../lib/validate-attachment';
// ... existing imports: useProofs/useUploadProof/useDeleteProof, ConfirmDialog, etc.

// inside the component:
const qc = useQueryClient();
const batch = useBatchUpload({
  upload: (file) => upload.mutateAsync(file),          // upload = useUploadProof(carId, eventId)
  validateOne: validateAttachmentFile,
  remaining: () => MAX_PROOFS_PER_EVENT - (proofs?.length ?? 0),
  onComplete: () => { void qc.invalidateQueries({ queryKey: ['cars', carId, 'events', eventId, 'proofs'] }); },
});

const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
  const files = Array.from(e.target.files ?? []);
  e.target.value = '';
  batch.start(files);
};
```

- Change the file input to `multiple` (keep `accept="image/*,application/pdf"`).
- Replace the single-file `error` Alert + `upload.isPending` spinner with `<BatchUploadStatus items={batch.items} running={batch.running} />`.
- The "Add proof" button `disabled={batch.running}`.
- Remove the now-unused `error` state and the old `validateAttachmentFile` inline call.

Read the current `ProofList.tsx` first and preserve everything except the upload path (thumbnails, PDF cards, lightbox, delete/ConfirmDialog, empty state).

- [ ] **Step 2: Typecheck + lint + build + tests**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build && pnpm --filter @carlog/web test`
Expected: all PASS. Confirm SW guard: `grep -c 'execute-api' apps/web/dist/sw.js` → `0`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ProofList.tsx
git commit -m "feat(web): multi-file batch upload in ProofList (event proofs)"
```

---

## Self-Review Notes

- **Spec coverage:** planBatch → T1; useBatchUpload + BatchUploadStatus + batchUploading key → T2; PhotoGallery multi + reason-key check → T3; ProofList multi → T4. Live verification + web deploy are done by the controller during the parallel-merge (this plan has no deploy task since it merges with the Google feature). All spec layers mapped.
- **Reuse, no duplication:** one `planBatch` + one `useBatchUpload` + one `BatchUploadStatus`, consumed by both galleries. Validators reused UNCHANGED.
- **Type consistency:** `BatchItemPlan` (T1) consumed by `useBatchUpload` (T2); `BatchItem`/`UploadState` (T2) consumed by `BatchUploadStatus` (T2) and the galleries (T3/T4); `remaining: () => number`, `upload: (file)=>Promise<void>`, `validateOne` signatures identical across hook + both consumers.
- **Correctness guards:** concurrency capped at 3 (shared `cursor` index); `remaining()` read at start (not stale); query invalidated ONCE via `onComplete`; failures isolated per item; over-cap reuses the validator's own key (no hardcoded message).
- **Parallel-safety:** touches only photo/proof galleries, new `lib/` files, `BatchUploadStatus`, and `common`/`photos`/`event` locale namespaces — all disjoint from the Google-signin worktree (auth/amplify/main/auth.json). No file or locale-namespace collision.
- **Placeholder scan:** every code step is complete; T3 Step 2 is a verify-and-only-add-if-missing check (not a placeholder — it confirms the validator's existing keys resolve).
- **No `any`; MUI only; extensionless imports; strings via t() EN+UK; conventional commits; SW guard re-checked in T4.**
