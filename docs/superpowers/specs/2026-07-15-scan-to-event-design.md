# Add Event by Invoice Photo (Scan-to-Event) — Design

**Date:** 2026-07-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Builds on:** the AI import pipeline (`extractEvents` use-case, `BedrockLlmProvider`,
`CandidateEvent`, the import review UI), the presign→S3→confirm proof flow, and the
single-table proof repository.

## Goal

Let a user photograph or upload an invoice/receipt/bill (image or PDF) on the vehicle
screen; Claude vision reads it and returns **one or more** candidate maintenance events
(a single bill can cover, e.g., an oil change AND a repair); the user reviews/edits them
in the existing import review list and commits; the scanned document is then **attached
as a proof to each created event** — reusing the single uploaded file via a server-side
S3 copy (no second upload).

## Locked Decisions

| Area | Decision |
|------|----------|
| Inputs | Image (JPEG/PNG/WebP/HEIC) OR PDF, single document, ≤ 10 MB (`MAX_SCAN_SIZE`, matches proof cap). |
| Output | **`CandidateEvent[]`** — one document may yield multiple events (oil change + repair). Feeds the SAME review list as text import. |
| Extraction | Sync single call (one doc fits the 29s window; no chunking/job pipeline). Claude vision via the Bedrock adapter (image block, or PDF document block). |
| Naming | NO "invoice" in code. Endpoint `POST /import/scan`; provider method `extractEventsFromDocument`; domain use-case `extractEventsFromDocument`; S3 prefix `scans/`. "Invoice" appears only in user-facing i18n (button label). |
| Byte path | ONE browser upload: presign → PUT to `scans/<ownerId>/<uuid>`. Lambda `GetObject`s it, base64-encodes, sends to Claude. |
| Auto-attach | On commit, the SAME S3 object is server-side **`CopyObject`**'d into each created event's proof key (`proofs/<ownerId>/<carId>/<eventId>/<proofId>`) and a proof row registered — no re-upload of bytes. The `scans/` scratch copy is lifecycle-deleted after 1 day. |
| Unknown cost | When a candidate/event cost is 0 ("not recorded"), the review card and timeline must NOT render "0 UAH" — show nothing / "—" for the amount. Data stays `cost: 0`. |
| Security | Ownership 404 before extraction; `s3Key` must start with `scans/<ownerId>/` (IDOR guard, same lesson as async import). |

## Architecture & Data Flow

```
Vehicle screen: "Scan invoice" → pick image/PDF (client validates type + ≤10MB)
  → POST /import/scan/presign { contentType, size } → { key, uploadUrl }   (key = scans/<ownerId>/<uuid>)
  → PUT file to uploadUrl (ONE upload)
  → POST /import/scan { carId, s3Key, contentType }
      → ownership check (404) ; s3Key startsWith scans/<ownerId>/ (400 IDOR)
      → Lambda GetObject(scans key) → base64 (size re-checked ≤ MAX_SCAN_SIZE → 422 if over/missing)
      → provider.extractEventsFromDocument(base64, mediaType, ctx)
          → Claude vision: image block (images) or document block (PDF) + record_events tool
          → validate → CandidateEvent[] (partial-tolerant; drop malformed; cap; 1 retry on shapeless)
      ← { events: CandidateEvent[] }        (ExtractEventsResponseSchema — same shape as text import)
  → review list (edit/remove cards; unknown cost shown blank) → "Add N events"
  → for each candidate: POST /cars/{carId}/events (existing) → eventId
      → POST /cars/{carId}/events/{eventId}/proofs/from-scan { s3Key, contentType }
          → server CopyObject scans/<...> → proofs/<owner>/<carId>/<eventId>/<proofId> ; register proof row
  → timeline shows each new event with the invoice attached as a proof
```

**Why S3 (not inline base64):** a 10 MB image base64s to ~13 MB, over API Gateway's
~10 MB request cap and Lambda's 6 MB sync-payload cap. The presign→S3→GetObject hop
(already proven by async import's `loadS3Text`) supports the full 10 MB. Claude does not
need S3 — it's a size workaround.

**Why server-side CopyObject (not a second upload, not the browser holding the File):**
one upload only; the durable proof is a metadata-only S3 copy of the object the Lambda
already read. Proof keys embed the eventId, which doesn't exist at scan time — so the copy
happens at proof-registration time, once the event exists.

**Reuse:** `CandidateEventSchema` (partial-tolerant), `ExtractEventsResponseSchema`, the
import review-list UI, the existing `POST /events` create route, the proof repository and
`proofs/` key scheme. New surface is the vision provider method, the scan routes, the
`from-scan` proof-confirm variant, and the "Scan invoice" trigger.

## Contracts (`packages/contracts/src/import.ts` additions)

```ts
export const SCAN_DOC_CONTENT_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
] as const;
export const ScanDocContentTypeSchema = z.enum(SCAN_DOC_CONTENT_TYPES);
export const MAX_SCAN_SIZE = 10_485_760; // 10 MB

export const ScanPresignRequestSchema = z.object({
  contentType: ScanDocContentTypeSchema,
  size: z.number().int().min(1).max(MAX_SCAN_SIZE),
});
export const ScanPresignResponseSchema = z.object({
  key: z.string().min(1), uploadUrl: z.string().url(),
});
export const ExtractFromScanRequestSchema = z.object({
  carId: z.string().uuid(),
  s3Key: z.string().min(1),
  contentType: ScanDocContentTypeSchema,
});
// Response reuses ExtractEventsResponseSchema { events: CandidateEvent[] }.
```

Proof `from-scan` request (in `packages/contracts/src/proof.ts` or import.ts, next to
`ProofConfirmSchema`): `{ s3Key: string, contentType: AttachmentContentType }` — the
event/car/proof ids come from the path + a minted proofId, matching the existing confirm.

## Provider Port + Use-Case + Adapter

- Port (`packages/domain/src/llm-provider.ts`): add
  `extractEventsFromDocument(base64: string, mediaType: string, ctx: ExtractionContext): Promise<unknown>`.
- Use-case (`packages/domain/src/extract-events.ts` or a sibling): `extractEventsFromDocument(base64, mediaType, provider, ctx): Promise<CandidateEvent[]>` — reuses the same `validate`/retry/cap helpers as `extractEvents` (refactor the shared validation into a helper both call; no behavior change to the text path).
- Adapter (`apps/api/src/bedrock-llm-provider.ts`): new method builds a vision message —
  image block for image mediaTypes, document block for `application/pdf` — plus the same
  `record_events` tool, `tool_choice`, adaptive thinking, `effort: 'low'`. Prompt: "Read
  this vehicle maintenance invoice/receipt. It may list MULTIPLE distinct services —
  return one event per service. Omit fields the document doesn't state." **Task implementing
  the adapter MUST invoke the `claude-api` skill first** to confirm the exact image/document
  content-block shape for the Bedrock Mantle SDK.

## Error Handling

| Failure | Result |
|---|---|
| Bad request (bad content type / oversize) | 400 (Zod) |
| Foreign/missing carId | 404 before extraction |
| `s3Key` not `scans/<ownerId>/…` | 400 (IDOR guard) |
| Scan object missing / oversized at read | 422 `ExtractionFailed` |
| Model returns zero valid events (unreadable) | 200 `{events: []}` → UI: "Couldn't read that document — add the event manually" |
| Model shapeless twice | 422 `ExtractionFailed` |
| Bedrock down | 503 `LlmUnavailable` |
| Auto-attach CopyObject/proof fails after event created | Event is NOT rolled back; surface a per-event "couldn't attach the scan" notice; the invoice remains re-attachable via the existing "Add proof". |

## Web

- Trigger: a "Scan invoice" action on the Vehicle screen (near the add-event / import
  controls). Reuses the file-pick + client validation pattern (type ∈ SCAN_DOC types,
  size ≤ 10 MB → `notSupported` / `tooLarge`).
- Flow: presign → PUT → `POST /import/scan` (spinner while Claude reads) → on success open
  the existing import review list seeded with the returned candidates. On `{events:[]}` show
  the "couldn't read" message with a "Enter manually" fallback (opens the normal Add-Event
  dialog). On error, the 422/503 messages (reuse `errorFailed`/`errorUnavailable`).
- Commit: for each reviewed candidate, create the event (existing), then call the
  `from-scan` proof-confirm with the scan `s3Key` so the invoice attaches to that event.
  Uses the committed-prefix retry pattern (don't duplicate on retry).
- **Unknown-cost display:** the review card and the timeline event card render the cost
  only when `> 0`; when `0`, show nothing (or a neutral "—"), never "0 UAH". This touches
  the existing EventCard/review rendering — fix in the same feature.
- i18n (`import` + `event` namespaces, EN+UK): `scanInvoice` (button), `scanning`
  (spinner), `scanUnreadable`, `enterManually`, `scanBadType`, `scanTooLarge`,
  `scanAttachFailed`.

## Testing

- Domain: `extractEventsFromDocument` unit tests with a fake provider — valid multi-event,
  empty (unreadable) → `[]`, malformed-dropped, shapeless→retry→fail. Confirm the shared
  validation helper keeps the text path's tests green.
- Contracts: content-type enum, size cap, request shapes.
- API/router: `POST /import/scan` 200 with events; ownership 404; IDOR 400 on foreign
  s3Key; 422 on missing object; the `from-scan` proof confirm does a CopyObject and
  registers a proof (in-memory storage fake asserts copy source/dest + proof row).
- Web: unknown-cost renders blank (component test if the harness supports it, else covered
  by the display-helper unit test); review→create→attach loop.
- Adapter vision call: integration boundary — live smoke only.
- Live smoke: photograph a real multi-service invoice → ≥1 candidate, correct-ish fields,
  unknown cost blank; commit → events on timeline each with the invoice attached as a proof;
  IDOR 400 on a foreign scan key.

## Scope Guard (YAGNI)

Out of scope: multi-file batch scanning, async job pipeline for scans (single sync call is
enough), editing the attached proof, OCR fallback, non-maintenance document types,
re-running extraction on an already-attached proof.

## Files (anticipated)

```
packages/contracts/src/import.ts                 MODIFY  scan schemas + from-scan proof req
packages/contracts/src/import.test.ts            MODIFY  schema tests
packages/domain/src/llm-provider.ts              MODIFY  extractEventsFromDocument port method
packages/domain/src/extract-events.ts            MODIFY  use-case + shared validate helper
packages/domain/src/extract-events.test.ts       MODIFY  document use-case tests
apps/api/src/bedrock-llm-provider.ts             MODIFY  vision method (claude-api skill first)
apps/api/src/in-memory-llm-provider.ts           MODIFY  fake extractEventsFromDocument
apps/api/src/scan-routes.ts                       CREATE  presign + POST /import/scan
apps/api/src/event-routes.ts                     MODIFY  from-scan proof-confirm (CopyObject)
apps/api/src/s3-photo-storage.ts                 MODIFY  copyObject(srcKey, destKey) on the port
apps/api/src/router.ts                           MODIFY  wire scan routes
apps/api/src/router.test.ts                      MODIFY  scan + from-scan tests
apps/api/src/handler.ts                          MODIFY  (deps already present; scan route needs storage+llm+cars)
infrastructure/cdk/lib/carlog-stack.ts           MODIFY  scan routes + scans/ 1-day lifecycle
apps/web/src/api-client.ts                        MODIFY  presignScan, extractFromScan, confirmProofFromScan
apps/web/src/queries.ts                           MODIFY  useExtractFromScan, useAttachScanProof
apps/web/src/components/ImportEventsDialog.tsx OR new ScanInvoice trigger  MODIFY/CREATE
apps/web/src/components/EventCard.tsx (+ review card)  MODIFY  hide cost when 0
apps/web/src/i18n/locales/{en,uk}/{import,event}.json  MODIFY  scan keys
```