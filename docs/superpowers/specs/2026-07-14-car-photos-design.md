# Car Photo Attachments — Design

**Date:** 2026-07-14
**Status:** Approved (brainstorming) → ready for implementation plan
**Builds on:** the deployed CarLog app (MVP + CRUD + PWA + redesign). Implements the
"attachments" piece of Phase 1 / `carlog-docs/ARCHITECTURE.md` (pre-signed S3, uploads
bypass Lambda).

## Goal

Let a signed-in owner add, view, and delete photos on a car's detail page — a car-level
gallery. Uploads go directly to a private S3 bucket via pre-signed PUT URLs (Lambda never
touches file bytes); photos are displayed via short-lived pre-signed GET URLs; metadata is
tracked in the existing DynamoDB table.

## Locked Decisions

| Area | Decision |
|------|----------|
| File types | Photos only: `image/jpeg`, `image/png`, `image/webp`, `image/heic` |
| Attach target | The car (car-level gallery on the Vehicle detail page). No polymorphic/event owner (YAGNI). |
| Thumbnails | None server-side; render original with `object-fit: cover` + `loading="lazy"` |
| Serving | Pre-signed GET URLs returned by the list endpoint; bucket stays fully private |
| Limits | Max 10 MB/file, image MIME only, soft cap 20 photos/car; delete with confirm |
| Upload flow | Approach A: presign → direct S3 PUT → confirm (metadata row) |
| Build strategy | Reuse existing single-table repo pattern + the one Lambda; testable seams for AWS |

## Layer 1 — Contracts + data model

New Zod schemas in `packages/contracts` (source of truth; types via `z.infer`):

```
ALLOWED_PHOTO_TYPES = ['image/jpeg','image/png','image/webp','image/heic']  (exported const)
MAX_PHOTO_SIZE = 10_485_760   (10 MB, exported const)
MAX_PHOTOS_PER_CAR = 20       (exported const)

PhotoContentTypeSchema = z.enum(ALLOWED_PHOTO_TYPES)
PhotoSchema        = { id, carId, ownerId, contentType, size, createdAt }
PresignRequestSchema  = { contentType: PhotoContentType, size: int 1..MAX_PHOTO_SIZE }
PresignResponseSchema = { photoId, uploadUrl, key }
PhotoWithUrlSchema    = PhotoSchema.extend({ url: string })   // url = pre-signed GET
```

**DynamoDB (existing table, existing owner partition):**
```
PK = USER#<ownerId>    SK = CAR#<carId>#PHOTO#<photoId>
```
- List a car's photos: `Query PK=USER#<owner> AND begins_with(SK, "CAR#<carId>#PHOTO#")`.
- Cap check: length of that query result.
- No new table, no GSI.

**S3 key:** `photos/<ownerId>/<carId>/<photoId>` (`photoId` = uuid). Bucket private;
access only via pre-signed URLs.

## Layer 2 — Infrastructure (CDK, extend CarLogStack)

- **`PhotosBucket`** (new, private): `BlockPublicAccess.BLOCK_ALL`, `RemovalPolicy.DESTROY`
  + `autoDeleteObjects` (MVP parity with other resources). **CORS** allowing `PUT` and
  `GET` from the CloudFront web origin and `http://localhost:5173` (so the browser's
  direct-to-S3 PUT and `<img>` GET are not blocked). Lifecycle rule to abort incomplete
  multipart uploads (cheap hygiene).
- **Lambda:** add `PHOTOS_BUCKET` env var to the existing `CarsFn`; grant it
  `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on `PhotosBucket/*` only (least
  privilege). No new Lambda.
- **No new frontend env var** — the web app calls the API; presign URLs are absolute.
- Cost/rate limiting: existing API Gateway stage throttle (20 r/s, burst 40) covers the
  new routes; 10 MB cap enforced server-side at presign AND via a content-length-range
  condition baked into the pre-signed PUT (client can't exceed the declared size).

## Layer 3 — Backend (API + repository)

**Routes** (added to the existing flat router in the same JWT-authorized Lambda; `ownerId`
from `event.requestContext.authorizer.jwt.claims.sub`):
```
POST   /cars/{id}/photos/presign   → validate → { photoId, uploadUrl, key }
POST   /cars/{id}/photos           → confirm  → write metadata row → 201 Photo
GET    /cars/{id}/photos           → list metadata + fresh GET url each → 200 PhotoWithUrl[]
DELETE /cars/{id}/photos/{photoId} → delete S3 object + metadata row → 204
```

**Testable seams (pure, unit-tested, no AWS):**
- `packages/domain`: `PhotoRepository` port (`create`, `listByCar`, `getById`, `delete`)
  + `createPhoto(ownerId, carId, input, deps?)` factory (validates via
  `PresignRequestSchema`; assigns id/createdAt; deps inject id/now like `createCar`).
- `apps/api` pure helpers: `photoKey(ownerId, carId, photoId)`,
  `assertUnderCap(count)` (throws `CapExceededError` when `count >= MAX_PHOTOS_PER_CAR`).

**AWS-touching layer (isolated; verified live, not unit-tested):**
- `S3PhotoStorage` wrapping `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`:
  `presignPut(key, contentType, maxSize)`, `presignGet(key)`, `deleteObject(key)`.
- `DynamoPhotoRepository implements PhotoRepository` — same single-table pattern as
  `DynamoCarRepository`.
- Both injected into handlers so the AWS SDK stays out of domain/router.

**Handler flow (thin, per the "thin Lambda" rule):**
- **presign:** verify the car belongs to the caller (reuse car repo `getById`; 404 if
  not) → `PresignRequestSchema.parse(body)` → `listByCar` → `assertUnderCap` (409 if full)
  → generate `photoId` → `presignPut(key, contentType, MAX_PHOTO_SIZE)` → return
  `{photoId, uploadUrl, key}`. No metadata written yet (so a failed/abandoned upload
  leaves no orphan row).
- **confirm:** verify car ownership → `createPhoto(ownerId, carId, {contentType,size})` →
  `repo.create` → 201 Photo.
- **list:** verify ownership → `listByCar` → map each metadata row to a fresh
  `presignGet(key)` → 200 `PhotoWithUrl[]`.
- **delete:** verify ownership → `getById` (404 if missing) → `storage.deleteObject(key)`
  then `repo.delete` → 204.
- Errors via existing `withErrorHandling`; new `CapExceededError` → 409, Zod → 400,
  not-found → 404.

**Security (IDOR-safe, same as cars):** every route derives `ownerId` from the JWT and
scopes the car lookup, the DynamoDB keys, and the S3 key prefix to that owner. A user
cannot presign/list/delete against another owner's car or photo. The bucket is never
public; photos are reachable only through short-lived signed URLs.

## Layer 4 — Frontend (Vehicle page gallery)

**API client** (`apps/web/src/api-client.ts`): reuse the existing `request<T>` wrapper for
the JSON calls; a raw `fetch` PUT for the S3 upload (no auth header; `Content-Type` = the
file's type; body = the `File`).
```
presignPhoto(token, carId, { contentType, size }) → PresignResponse
uploadToS3(uploadUrl, file)                        → raw PUT to S3
confirmPhoto(token, carId, photoId)                → Photo
listPhotos(token, carId)                           → PhotoWithUrl[]
deletePhoto(token, carId, photoId)                 → void
uploadPhoto(token, carId, file)   // orchestrates presign → uploadToS3 → confirm
```

**Query hooks** (`queries.ts`), following the existing pattern:
- `usePhotos(carId)` — key `['cars', carId, 'photos']`.
- `useUploadPhoto(carId)` / `useDeletePhoto(carId)` — invalidate that key on success.

**UI — `components/PhotoGallery.tsx`, rendered below the spec card on the Vehicle page:**
- "Photos" header + **Add photo** button → hidden `<input type="file" accept="image/*">`.
- **Client pre-validation** via a pure `validatePhotoFile(file, currentCount)` helper using
  the shared contracts constants (type ∈ allowed, size ≤ 10 MB, count < 20) → inline error
  before calling the API; server re-validates authoritatively.
- **Grid of square thumbnails** (`object-fit: cover`, `loading="lazy"`) from each photo's
  pre-signed `url`; tap → full-size lightbox (MUI `Dialog`).
- Per-photo **delete** (overlay icon → reuse existing `ConfirmDialog`).
- **States:** uploading (disabled add button + spinner tile), `StatusView` loading, empty
  ("No photos yet"), error (MUI `Alert`). Inherits the redesign theme; no new tokens.

## Testing

- **Unit (Vitest):** contracts schema round-trips (valid/invalid type, size bounds);
  `createPhoto` validation; `photoKey`; `assertUnderCap` (under/at/over cap);
  `validatePhotoFile` (type/size/count branches). The S3 adapter and Dynamo repo are NOT
  unit-tested (AWS round-trip) — verified live.
- **Static gates:** `pnpm turbo run typecheck lint test` green across all packages.
- **SW guard:** after build, `grep -c execute-api dist/sw.js == 0` still holds (photos API
  and S3 must never be cached by the service worker).

## Verification (definition of done)

Deploy backend + web (infra + Lambda change, so both), then on the deployed app:
1. Open a car → Add photo (from phone camera/library or desktop file) → it appears in the
   grid.
2. Reload → the photo persists.
3. An >10 MB file and the 21st photo are rejected with clear messages (client + server).
4. Delete a photo (confirm) → it disappears from the grid and stays gone after reload; the
   S3 object is gone.
5. A direct S3 object URL without a signature returns 403 (bucket private).
6. `GET /cars` and the photo API calls hit the network, not the service worker.

## Scope Guard (YAGNI)

Out of scope: PDFs/other file types, server-side thumbnails, image captions/reordering,
CloudFront for images, polymorphic (event) attachments, and any change to auth/CDK beyond
the photos bucket + Lambda grant/env.

## Files (anticipated)

```
packages/contracts/src/photo.ts               CREATE  schemas + constants
packages/contracts/src/photo.test.ts          CREATE
packages/contracts/src/index.ts               MODIFY  export photo
packages/domain/src/photo.ts                  CREATE  createPhoto + CapExceededError
packages/domain/src/photo-repository.ts        CREATE  PhotoRepository port
packages/domain/src/photo.test.ts             CREATE
packages/domain/src/index.ts                   MODIFY  export photo bits
apps/api/src/photo-key.ts                      CREATE  photoKey + assertUnderCap (pure)
apps/api/src/photo-key.test.ts                 CREATE
apps/api/src/s3-photo-storage.ts               CREATE  S3 adapter (presign put/get, delete)
apps/api/src/dynamo-photo-repository.ts        CREATE  PhotoRepository impl
apps/api/src/photo-routes.ts                   CREATE  handlers for the 4 routes
apps/api/src/router.ts                         MODIFY  dispatch /cars/{id}/photos*
apps/api/src/handler.ts                        MODIFY  build S3 storage + photo repo, pass in
apps/api/src/in-memory-car-repository.ts       (test fakes may gain a photo fake)
apps/api/src/router.test.ts                    MODIFY  photo route tests w/ fakes
apps/api/package.json                          MODIFY  + @aws-sdk/client-s3, s3-request-presigner
infrastructure/cdk/lib/carlog-stack.ts         MODIFY  PhotosBucket + CORS + env + grants
apps/web/src/api-client.ts                     MODIFY  presign/upload/confirm/list/delete
apps/web/src/queries.ts                        MODIFY  usePhotos/useUploadPhoto/useDeletePhoto
apps/web/src/lib/validate-photo.ts             CREATE  validatePhotoFile (pure)
apps/web/src/lib/validate-photo.test.ts        CREATE
apps/web/src/components/PhotoGallery.tsx       CREATE
apps/web/src/routes/Vehicle.tsx                MODIFY  render <PhotoGallery carId=.../>
```
