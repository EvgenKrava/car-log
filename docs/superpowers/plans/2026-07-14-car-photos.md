# Car Photo Attachments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in owner add, view, and delete photos on a car's detail page — uploaded directly to a private S3 bucket via pre-signed PUT URLs (Lambda never touches bytes), displayed via short-lived pre-signed GET URLs, with metadata in the existing DynamoDB table.

**Architecture:** Presign → direct S3 PUT → confirm. New Zod contracts + shared constants; a domain `PhotoRepository` port + `createPhoto` factory; pure API helpers (`photoKey`, `assertUnderCap`); an isolated `S3PhotoStorage` adapter + `DynamoPhotoRepository`; four new routes on the existing JWT-authorized Lambda; a `PhotoGallery` on the Vehicle page. Owner-scoped everywhere (IDOR-safe); bucket stays fully private.

**Tech Stack:** TypeScript (strict), Zod, AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, existing `lib-dynamodb`), AWS CDK v2, React 18 + MUI v6 + TanStack Query, Vitest.

## Global Constraints

- **Frontend uploads bypass Lambda** — browser PUTs bytes directly to S3 via a pre-signed URL. Lambda only presigns/confirms/lists/deletes metadata. Never stream file bytes through Lambda.
- Strict TypeScript, never `any`. Prefer `type`; `interface` only for service abstractions (repository/storage ports).
- Zod is the contract source of truth; derive types with `z.infer`. No hand-written duplicating types.
- Extensionless relative imports. MUI only on the frontend.
- **Bucket is fully private** (`BLOCK_ALL`); photos reachable only via short-lived pre-signed URLs. No public-read, no CloudFront for images.
- **Owner scoping (IDOR-safe):** every route derives `ownerId` from the JWT (`event.requestContext.authorizer.jwt.claims.sub`); the car lookup, DynamoDB keys, and S3 key prefix are all scoped to that owner.
- Limits (exact values, from spec): `ALLOWED_PHOTO_TYPES = ['image/jpeg','image/png','image/webp','image/heic']`, `MAX_PHOTO_SIZE = 10_485_760`, `MAX_PHOTOS_PER_CAR = 20`.
- DynamoDB: `PK = USER#<ownerId>`, `SK = CAR#<carId>#PHOTO#<photoId>`. S3 key: `photos/<ownerId>/<carId>/<photoId>`.
- The service worker must still NOT cache the API/S3 — after any web build, `grep -c execute-api dist/sw.js == 0`.
- Conventional commits; NO co-authorship trailers. AWS: profile `yevhenii`, region `us-east-1`.

## File Structure

```
packages/contracts/src/photo.ts               CREATE  schemas + constants (Task 1)
packages/contracts/src/photo.test.ts          CREATE  (Task 1)
packages/contracts/src/index.ts               MODIFY  export photo (Task 1)
packages/domain/src/photo.ts                  CREATE  createPhoto + CapExceededError (Task 2)
packages/domain/src/photo-repository.ts        CREATE  PhotoRepository + PhotoStorage ports (Task 2)
packages/domain/src/photo.test.ts             CREATE  (Task 2)
packages/domain/src/index.ts                   MODIFY  export photo bits (Task 2)
apps/api/src/photo-key.ts                      CREATE  photoKey + assertUnderCap (Task 3)
apps/api/src/photo-key.test.ts                 CREATE  (Task 3)
apps/api/src/in-memory-photo-repository.ts     CREATE  test fake (Task 3)
apps/api/src/photo-routes.ts                   CREATE  4 handlers (Task 4)
apps/api/src/router.ts                         MODIFY  route(deps,event) + photo dispatch (Task 4)
apps/api/src/router.test.ts                    MODIFY  deps object + photo route tests (Task 4)
apps/api/src/s3-photo-storage.ts               CREATE  S3 adapter (Task 5)
apps/api/src/dynamo-photo-repository.ts        CREATE  PhotoRepository impl (Task 5)
apps/api/src/handler.ts                        MODIFY  build storage+photo repo, pass deps (Task 5)
apps/api/package.json                          MODIFY  + @aws-sdk/client-s3, s3-request-presigner (Task 5)
infrastructure/cdk/lib/carlog-stack.ts         MODIFY  PhotosBucket + CORS + env + grants + routes (Task 6)
apps/web/src/lib/validate-photo.ts             CREATE  validatePhotoFile (Task 7)
apps/web/src/lib/validate-photo.test.ts        CREATE  (Task 7)
apps/web/src/api-client.ts                     MODIFY  presign/upload/confirm/list/delete (Task 7)
apps/web/src/queries.ts                        MODIFY  usePhotos/useUploadPhoto/useDeletePhoto (Task 7)
apps/web/src/components/PhotoGallery.tsx       CREATE  (Task 8)
apps/web/src/routes/Vehicle.tsx                MODIFY  render <PhotoGallery /> (Task 8)
```

Task order: contracts (1) → domain (2) → api pure helpers + fake (3) → routes + router wiring, tested with fakes (4) → S3/Dynamo adapters + handler (5) → CDK (6) → web api/hooks/validation (7) → gallery UI (8) → verify + deploy (9).

---

### Task 1: Photo contracts + constants

**Files:**
- Create: `packages/contracts/src/photo.ts`, `packages/contracts/src/photo.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces: consts `ALLOWED_PHOTO_TYPES`, `MAX_PHOTO_SIZE`, `MAX_PHOTOS_PER_CAR`; schemas `PhotoContentTypeSchema`, `PhotoSchema`, `PresignRequestSchema`, `PresignResponseSchema`, `PhotoWithUrlSchema`; types `Photo`, `PhotoContentType`, `PresignRequest`, `PresignResponse`, `PhotoWithUrl`.

- [ ] **Step 1: Write the failing test — `packages/contracts/src/photo.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { PresignRequestSchema, PhotoSchema, MAX_PHOTO_SIZE } from './photo';

describe('PresignRequestSchema', () => {
  it('accepts a valid image request', () => {
    expect(PresignRequestSchema.parse({ contentType: 'image/jpeg', size: 1024 }))
      .toEqual({ contentType: 'image/jpeg', size: 1024 });
  });
  it('rejects a non-image content type', () => {
    expect(() => PresignRequestSchema.parse({ contentType: 'application/pdf', size: 1024 })).toThrow();
  });
  it('rejects a size over the max', () => {
    expect(() => PresignRequestSchema.parse({ contentType: 'image/png', size: MAX_PHOTO_SIZE + 1 })).toThrow();
  });
  it('rejects a zero/negative size', () => {
    expect(() => PresignRequestSchema.parse({ contentType: 'image/png', size: 0 })).toThrow();
  });
});

describe('PhotoSchema', () => {
  it('requires id/carId/ownerId/contentType/size/createdAt', () => {
    expect(() => PhotoSchema.parse({ contentType: 'image/png', size: 10 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/contracts test`
Expected: FAIL — cannot resolve `./photo`.

- [ ] **Step 3: Create `packages/contracts/src/photo.ts`**

```ts
import { z } from 'zod';

export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export const MAX_PHOTO_SIZE = 10_485_760; // 10 MB
export const MAX_PHOTOS_PER_CAR = 20;

export const PhotoContentTypeSchema = z.enum(ALLOWED_PHOTO_TYPES);

export const PresignRequestSchema = z.object({
  contentType: PhotoContentTypeSchema,
  size: z.number().int().min(1).max(MAX_PHOTO_SIZE),
});

export const PhotoSchema = z.object({
  id: z.string().uuid(),
  carId: z.string().uuid(),
  ownerId: z.string().min(1),
  contentType: PhotoContentTypeSchema,
  size: z.number().int().min(1).max(MAX_PHOTO_SIZE),
  createdAt: z.string().datetime(),
});

export const PresignResponseSchema = z.object({
  photoId: z.string().uuid(),
  uploadUrl: z.string().url(),
  key: z.string().min(1),
});

export const PhotoWithUrlSchema = PhotoSchema.extend({ url: z.string().url() });

export type PhotoContentType = z.infer<typeof PhotoContentTypeSchema>;
export type PresignRequest = z.infer<typeof PresignRequestSchema>;
export type Photo = z.infer<typeof PhotoSchema>;
export type PresignResponse = z.infer<typeof PresignResponseSchema>;
export type PhotoWithUrl = z.infer<typeof PhotoWithUrlSchema>;
```

- [ ] **Step 4: Export from `packages/contracts/src/index.ts`**

Add after the existing car export line:

```ts
export * from './photo';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @carlog/contracts test`
Expected: PASS (existing car tests + 5 new photo tests).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/photo.ts packages/contracts/src/photo.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add photo schemas and limits"
```

---

### Task 2: Domain — createPhoto + repository/storage ports

**Files:**
- Create: `packages/domain/src/photo.ts`, `packages/domain/src/photo-repository.ts`, `packages/domain/src/photo.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `Photo`, `PresignRequest` from `@carlog/contracts`.
- Produces:
  - `createPhoto(ownerId: string, carId: string, input: PresignRequest, deps?: { newId?: () => string; now?: () => string }): Photo`
  - `class CapExceededError extends Error`
  - `class PhotoNotFoundError extends Error`
  - `interface PhotoRepository { create(p: Photo): Promise<Photo>; listByCar(ownerId: string, carId: string): Promise<Photo[]>; getById(ownerId: string, carId: string, photoId: string): Promise<Photo | null>; delete(ownerId: string, carId: string, photoId: string): Promise<void>; }`
  - `interface PhotoStorage { presignPut(key: string, contentType: string, maxSize: number): Promise<string>; presignGet(key: string): Promise<string>; deleteObject(key: string): Promise<void>; }`

- [ ] **Step 1: Write the failing test — `packages/domain/src/photo.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createPhoto } from './photo';

const deps = { newId: () => 'photo-id', now: () => '2026-07-14T00:00:00.000Z' };

describe('createPhoto', () => {
  it('assigns id/ownerId/carId/timestamps from a valid presign request', () => {
    const p = createPhoto('u1', '11111111-1111-1111-1111-111111111111',
      { contentType: 'image/jpeg', size: 2048 }, deps);
    expect(p).toMatchObject({
      id: 'photo-id', ownerId: 'u1', carId: '11111111-1111-1111-1111-111111111111',
      contentType: 'image/jpeg', size: 2048, createdAt: '2026-07-14T00:00:00.000Z',
    });
  });
  it('rejects an invalid content type', () => {
    expect(() => createPhoto('u1', '11111111-1111-1111-1111-111111111111',
      // @ts-expect-error invalid content type on purpose
      { contentType: 'application/pdf', size: 10 }, deps)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/domain test`
Expected: FAIL — cannot resolve `./photo`.

- [ ] **Step 3: Create `packages/domain/src/photo.ts`**

```ts
import { PresignRequestSchema, type Photo, type PresignRequest } from '@carlog/contracts';
import { newId as defaultNewId, nowIso } from './id';

export type CreatePhotoDeps = { newId?: () => string; now?: () => string };

export function createPhoto(
  ownerId: string, carId: string, input: PresignRequest, deps: CreatePhotoDeps = {},
): Photo {
  const data = PresignRequestSchema.parse(input);
  return {
    id: (deps.newId ?? defaultNewId)(),
    carId,
    ownerId,
    contentType: data.contentType,
    size: data.size,
    createdAt: (deps.now ?? nowIso)(),
  };
}

export class CapExceededError extends Error {
  constructor() {
    super('Photo limit reached for this car');
    this.name = 'CapExceededError';
  }
}

export class PhotoNotFoundError extends Error {
  constructor(id: string) {
    super(`Photo ${id} not found`);
    this.name = 'PhotoNotFoundError';
  }
}
```

- [ ] **Step 4: Create `packages/domain/src/photo-repository.ts`**

```ts
import type { Photo } from '@carlog/contracts';

export interface PhotoRepository {
  create(photo: Photo): Promise<Photo>;
  listByCar(ownerId: string, carId: string): Promise<Photo[]>;
  getById(ownerId: string, carId: string, photoId: string): Promise<Photo | null>;
  delete(ownerId: string, carId: string, photoId: string): Promise<void>;
}

export interface PhotoStorage {
  presignPut(key: string, contentType: string, maxSize: number): Promise<string>;
  presignGet(key: string): Promise<string>;
  deleteObject(key: string): Promise<void>;
}
```

- [ ] **Step 5: Export from `packages/domain/src/index.ts`**

Add:

```ts
export * from './photo';
export * from './photo-repository';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @carlog/domain test`
Expected: PASS (existing car tests + 2 new photo tests).

- [ ] **Step 7: Typecheck (confirm domain stays AWS-free)**

Run: `pnpm --filter @carlog/domain typecheck`
Expected: PASS. (No `@aws-sdk` import anywhere in domain.)

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/photo.ts packages/domain/src/photo-repository.ts packages/domain/src/photo.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): add createPhoto factory and PhotoRepository/PhotoStorage ports"
```

---

### Task 3: API pure helpers + in-memory photo fake

**Files:**
- Create: `apps/api/src/photo-key.ts`, `apps/api/src/photo-key.test.ts`, `apps/api/src/in-memory-photo-repository.ts`

**Interfaces:**
- Consumes: `MAX_PHOTOS_PER_CAR`, `Photo` from `@carlog/contracts`; `CapExceededError`, `PhotoNotFoundError`, `PhotoRepository` from `@carlog/domain`.
- Produces:
  - `photoKey(ownerId: string, carId: string, photoId: string): string` → `photos/<ownerId>/<carId>/<photoId>`
  - `assertUnderCap(count: number): void` → throws `CapExceededError` if `count >= MAX_PHOTOS_PER_CAR`
  - `class InMemoryPhotoRepository implements PhotoRepository`

- [ ] **Step 1: Write the failing test — `apps/api/src/photo-key.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { photoKey, assertUnderCap } from './photo-key';
import { CapExceededError } from '@carlog/domain';
import { MAX_PHOTOS_PER_CAR } from '@carlog/contracts';

describe('photoKey', () => {
  it('builds an owner/car-scoped key', () => {
    expect(photoKey('u1', 'c1', 'p1')).toBe('photos/u1/c1/p1');
  });
});

describe('assertUnderCap', () => {
  it('allows a count under the cap', () => {
    expect(() => assertUnderCap(MAX_PHOTOS_PER_CAR - 1)).not.toThrow();
  });
  it('throws CapExceededError at the cap', () => {
    expect(() => assertUnderCap(MAX_PHOTOS_PER_CAR)).toThrow(CapExceededError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/api test`
Expected: FAIL — cannot resolve `./photo-key`.

- [ ] **Step 3: Create `apps/api/src/photo-key.ts`**

```ts
import { MAX_PHOTOS_PER_CAR } from '@carlog/contracts';
import { CapExceededError } from '@carlog/domain';

export const photoKey = (ownerId: string, carId: string, photoId: string): string =>
  `photos/${ownerId}/${carId}/${photoId}`;

export function assertUnderCap(count: number): void {
  if (count >= MAX_PHOTOS_PER_CAR) throw new CapExceededError();
}
```

- [ ] **Step 4: Create `apps/api/src/in-memory-photo-repository.ts`**

```ts
import type { Photo } from '@carlog/contracts';
import { type PhotoRepository } from '@carlog/domain';

export class InMemoryPhotoRepository implements PhotoRepository {
  private photos = new Map<string, Photo>();
  private key(ownerId: string, carId: string, photoId: string) { return `${ownerId}#${carId}#${photoId}`; }

  async create(photo: Photo): Promise<Photo> {
    this.photos.set(this.key(photo.ownerId, photo.carId, photo.id), photo);
    return photo;
  }
  async listByCar(ownerId: string, carId: string): Promise<Photo[]> {
    return [...this.photos.values()].filter((p) => p.ownerId === ownerId && p.carId === carId);
  }
  async getById(ownerId: string, carId: string, photoId: string): Promise<Photo | null> {
    return this.photos.get(this.key(ownerId, carId, photoId)) ?? null;
  }
  async delete(ownerId: string, carId: string, photoId: string): Promise<void> {
    this.photos.delete(this.key(ownerId, carId, photoId));
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @carlog/api test`
Expected: PASS (existing router tests + 3 new photo-key tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/photo-key.ts apps/api/src/photo-key.test.ts apps/api/src/in-memory-photo-repository.ts
git commit -m "feat(api): add photoKey/assertUnderCap helpers and in-memory photo fake"
```

---

### Task 4: Photo route handlers + router wiring (tested with fakes)

**Files:**
- Create: `apps/api/src/photo-routes.ts`
- Modify: `apps/api/src/router.ts`, `apps/api/src/router.test.ts`

**Interfaces:**
- Consumes: `CarRepository`, `PhotoRepository`, `PhotoStorage`, `createPhoto`, `CapExceededError`, `PhotoNotFoundError`, `CarNotFoundError` from `@carlog/domain`; `PresignRequestSchema` from `@carlog/contracts`; `photoKey`, `assertUnderCap` (Task 3); `ok`, `withErrorHandling`, `ApiResult`, `ApiEvent` from existing files.
- Produces:
  - `type RouteDeps = { cars: CarRepository; photos: PhotoRepository; storage: PhotoStorage }`
  - `route(deps: RouteDeps, event: ApiEvent): Promise<ApiResult>` (CHANGED signature — was `route(repo, event)`).
  - `handlePhotoRoute(deps, event, carId): Promise<ApiResult | null>` (returns null if not a photo path).

- [ ] **Step 1: Update `apps/api/src/errors.ts` to map CapExceededError → 409**

In `withErrorHandling`'s catch chain (in `apps/api/src/errors.ts`), add a branch BEFORE the generic 500. Locate the existing `CarNotFoundError` branch and add alongside it:

```ts
    if (err instanceof CapExceededError) {
      return { statusCode: 409, headers: CORS, body: JSON.stringify({ error: 'CapExceeded', message: err.message }) };
    }
    if (err instanceof PhotoNotFoundError) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'NotFound', message: err.message }) };
    }
```

and update the import at the top of `errors.ts`:

```ts
import { CarNotFoundError, CapExceededError, PhotoNotFoundError } from '@carlog/domain';
```

(`CORS` and the existing structure are already present; only add the two branches + import names.)

- [ ] **Step 2: Create `apps/api/src/photo-routes.ts`**

```ts
import { PresignRequestSchema } from '@carlog/contracts';
import {
  CarNotFoundError, PhotoNotFoundError, createPhoto,
  type CarRepository, type PhotoRepository, type PhotoStorage,
} from '@carlog/domain';
import { MAX_PHOTO_SIZE } from '@carlog/contracts';
import { ok, type ApiResult } from './errors';
import { photoKey, assertUnderCap } from './photo-key';
import type { ApiEvent } from './router';

export type PhotoDeps = { cars: CarRepository; photos: PhotoRepository; storage: PhotoStorage };

async function requireCar(deps: PhotoDeps, ownerId: string, carId: string) {
  const car = await deps.cars.getById(ownerId, carId);
  if (!car) throw new CarNotFoundError(carId);
}

// Returns an ApiResult for any /cars/{carId}/photos* route, or null if `event` is not one.
export async function handlePhotoRoute(
  deps: PhotoDeps, event: ApiEvent, ownerId: string, carId: string,
): Promise<ApiResult | null> {
  const { method, path, pathParams, body } = event;
  const base = `/cars/${carId}/photos`;

  if (path === `${base}/presign` && method === 'POST') {
    await requireCar(deps, ownerId, carId);
    const req = PresignRequestSchema.parse(body);
    const existing = await deps.photos.listByCar(ownerId, carId);
    assertUnderCap(existing.length);
    const photoId = crypto.randomUUID();
    const key = photoKey(ownerId, carId, photoId);
    const uploadUrl = await deps.storage.presignPut(key, req.contentType, MAX_PHOTO_SIZE);
    return ok(200, { photoId, uploadUrl, key });
  }

  if (path === base && method === 'POST') {
    await requireCar(deps, ownerId, carId);
    const req = PresignRequestSchema.parse(body);
    const photo = createPhoto(ownerId, carId, req);
    return ok(201, await deps.photos.create(photo));
  }

  if (path === base && method === 'GET') {
    await requireCar(deps, ownerId, carId);
    const photos = await deps.photos.listByCar(ownerId, carId);
    const withUrls = await Promise.all(
      photos.map(async (p) => ({ ...p, url: await deps.storage.presignGet(photoKey(ownerId, carId, p.id)) })),
    );
    return ok(200, withUrls);
  }

  const photoId = pathParams.photoId;
  if (photoId && path === `${base}/${photoId}` && method === 'DELETE') {
    await requireCar(deps, ownerId, carId);
    const photo = await deps.photos.getById(ownerId, carId, photoId);
    if (!photo) throw new PhotoNotFoundError(photoId);
    await deps.storage.deleteObject(photoKey(ownerId, carId, photoId));
    await deps.photos.delete(ownerId, carId, photoId);
    return ok(204, null);
  }

  return null;
}
```

Note: `crypto.randomUUID()` is available in the Node 20 Lambda runtime (global `crypto`). The confirm route (`POST base`) re-parses `PresignRequestSchema` (contentType+size) — the client resends those on confirm.

- [ ] **Step 3: Rewrite `apps/api/src/router.ts` to take deps and dispatch photos**

```ts
import { CreateCarSchema } from '@carlog/contracts';
import { CarNotFoundError, createCar, type CarRepository, type PhotoRepository, type PhotoStorage } from '@carlog/domain';
import { ok, withErrorHandling, type ApiResult } from './errors';
import { handlePhotoRoute } from './photo-routes';

export type ApiEvent = {
  method: string;
  path: string;
  ownerId: string | null;
  pathParams: Record<string, string>;
  body: unknown;
};

export type RouteDeps = { cars: CarRepository; photos: PhotoRepository; storage: PhotoStorage };

export function route(deps: RouteDeps, event: ApiEvent): Promise<ApiResult> {
  return withErrorHandling(async () => {
    const { method, path, ownerId, pathParams, body } = event;
    if (!ownerId) return ok(401, { error: 'Unauthorized' });
    const id = pathParams.id;

    // Photo sub-routes: /cars/{id}/photos*
    if (id && path.startsWith(`/cars/${id}/photos`)) {
      const result = await handlePhotoRoute(deps, event, ownerId, id);
      if (result) return result;
    }

    if (path === '/cars' && method === 'GET') return ok(200, await deps.cars.listByOwner(ownerId));
    if (path === '/cars' && method === 'POST') {
      const car = createCar(ownerId, CreateCarSchema.parse(body));
      return ok(201, await deps.cars.create(car));
    }
    if (id && path === `/cars/${id}` && method === 'PUT') return ok(200, await deps.cars.update(ownerId, id, CreateCarSchema.parse(body)));
    if (id && path === `/cars/${id}` && method === 'DELETE') { await deps.cars.delete(ownerId, id); return ok(204, null); }
    if (id && path === `/cars/${id}` && method === 'GET') {
      const car = await deps.cars.getById(ownerId, id);
      if (!car) throw new CarNotFoundError(id);
      return ok(200, car);
    }
    return ok(404, { error: 'NoRoute' });
  });
}
```

Note the car routes now guard on the exact `path === '/cars/${id}'` so a `/cars/{id}/photos` path can't accidentally match the car GET/PUT/DELETE branch. `handlePhotoRoute` is tried first for photo paths.

- [ ] **Step 4: Update `apps/api/src/router.test.ts` — deps object + photo tests**

At the top, replace the single-repo setup with a deps object and a fake storage. Change the `beforeEach` and add a stub storage:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { route, type ApiEvent } from './router';
import { InMemoryCarRepository } from './in-memory-car-repository';
import { InMemoryPhotoRepository } from './in-memory-photo-repository';
import type { PhotoStorage } from '@carlog/domain';

let cars: InMemoryCarRepository;
let photos: InMemoryPhotoRepository;
const storage: PhotoStorage = {
  presignPut: async () => 'https://s3.example/put',
  presignGet: async () => 'https://s3.example/get',
  deleteObject: async () => {},
};
let deps: { cars: InMemoryCarRepository; photos: InMemoryPhotoRepository; storage: PhotoStorage };
beforeEach(() => {
  cars = new InMemoryCarRepository();
  photos = new InMemoryPhotoRepository();
  deps = { cars, photos, storage };
});

const base = { pathParams: {}, body: null } as const;
const validBody = { make: 'Toyota', model: 'Corolla', year: 2020, mileage: 45000, fuelType: 'petrol' };
```

Then update EVERY existing `route(repo, ...)` call to `route(deps, ...)` (the car tests). Keep their assertions identical. Add these photo tests inside the describe block:

```ts
async function makeCar(ownerId: string) {
  const res = await route(deps, { ...base, method: 'POST', path: '/cars', ownerId, body: validBody });
  return JSON.parse(res.body).id as string;
}

describe('photo routes', () => {
  const img = { contentType: 'image/jpeg', size: 2048 };

  it('presign returns an upload url for the owner\'s car', async () => {
    const carId = await makeCar('u1');
    const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/photos/presign`, ownerId: 'u1', pathParams: { id: carId }, body: img });
    expect(res.statusCode).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.uploadUrl).toBe('https://s3.example/put');
    expect(b.photoId).toBeDefined();
  });

  it('presign 404s for a car the caller does not own', async () => {
    const carId = await makeCar('u1');
    const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/photos/presign`, ownerId: 'u2', pathParams: { id: carId }, body: img });
    expect(res.statusCode).toBe(404);
  });

  it('confirm creates metadata, list returns it with a url', async () => {
    const carId = await makeCar('u1');
    const created = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/photos`, ownerId: 'u1', pathParams: { id: carId }, body: img });
    expect(created.statusCode).toBe(201);
    const list = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/photos`, ownerId: 'u1', pathParams: { id: carId } });
    expect(list.statusCode).toBe(200);
    const arr = JSON.parse(list.body);
    expect(arr).toHaveLength(1);
    expect(arr[0].url).toBe('https://s3.example/get');
  });

  it('presign 409s when the per-car cap is reached', async () => {
    const carId = await makeCar('u1');
    for (let i = 0; i < 20; i++) {
      await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/photos`, ownerId: 'u1', pathParams: { id: carId }, body: img });
    }
    const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/photos/presign`, ownerId: 'u1', pathParams: { id: carId }, body: img });
    expect(res.statusCode).toBe(409);
  });

  it('delete removes a photo (404 when missing)', async () => {
    const carId = await makeCar('u1');
    const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/photos`, ownerId: 'u1', pathParams: { id: carId }, body: img })).body);
    const del = await route(deps, { ...base, method: 'DELETE', path: `/cars/${carId}/photos/${created.id}`, ownerId: 'u1', pathParams: { id: carId, photoId: created.id } });
    expect(del.statusCode).toBe(204);
    const missing = await route(deps, { ...base, method: 'DELETE', path: `/cars/${carId}/photos/${created.id}`, ownerId: 'u1', pathParams: { id: carId, photoId: created.id } });
    expect(missing.statusCode).toBe(404);
  });
});
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @carlog/api test`
Expected: PASS — the 6 existing car tests (now using `deps`) + 5 photo route tests.

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm --filter @carlog/api typecheck && pnpm --filter @carlog/api lint`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/photo-routes.ts apps/api/src/router.ts apps/api/src/router.test.ts apps/api/src/errors.ts
git commit -m "feat(api): add photo routes and thread car/photo/storage deps through router"
```

---

### Task 5: S3 storage adapter + Dynamo photo repo + handler wiring

**Files:**
- Create: `apps/api/src/s3-photo-storage.ts`, `apps/api/src/dynamo-photo-repository.ts`
- Modify: `apps/api/src/handler.ts`, `apps/api/package.json`

**Interfaces:**
- Consumes: `PhotoStorage`, `PhotoRepository` ports; `Photo` from contracts; existing `DynamoDBDocumentClient`.
- Produces: `class S3PhotoStorage implements PhotoStorage` (ctor `(bucket, S3Client)`), `class DynamoPhotoRepository implements PhotoRepository` (ctor `(tableName, DynamoDBDocumentClient)`); handler builds all three deps.

- [ ] **Step 1: Add AWS SDK S3 deps to `apps/api/package.json`**

In `dependencies` add `"@aws-sdk/client-s3": "^3.658.0"` and `"@aws-sdk/s3-request-presigner": "^3.658.0"` (match the existing `@aws-sdk/*` version line). Run `pnpm install` from repo root.

- [ ] **Step 2: Create `apps/api/src/s3-photo-storage.ts`**

```ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PhotoStorage } from '@carlog/domain';

const PRESIGN_TTL_SECONDS = 3600; // 1 hour

export class S3PhotoStorage implements PhotoStorage {
  constructor(private readonly bucket: string, private readonly client: S3Client) {}

  async presignPut(key: string, contentType: string, maxSize: number): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: maxSize,
    });
    return getSignedUrl(this.client, cmd, { expiresIn: PRESIGN_TTL_SECONDS });
  }

  async presignGet(key: string): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: PRESIGN_TTL_SECONDS });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
```

Note: `ContentLength: maxSize` in the presigned PUT bounds the upload to the declared max (the client cannot upload more than `maxSize` bytes against this URL).

- [ ] **Step 3: Create `apps/api/src/dynamo-photo-repository.ts`**

```ts
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Photo } from '@carlog/contracts';
import { type PhotoRepository } from '@carlog/domain';

const pk = (ownerId: string) => `USER#${ownerId}`;
const sk = (carId: string, photoId: string) => `CAR#${carId}#PHOTO#${photoId}`;
const skPrefix = (carId: string) => `CAR#${carId}#PHOTO#`;

type Row = Photo & { PK: string; SK: string };
const toRow = (p: Photo): Row => ({ ...p, PK: pk(p.ownerId), SK: sk(p.carId, p.id) });
const toPhoto = (row: Record<string, unknown>): Photo => {
  const { PK, SK, ...photo } = row as Row;
  return photo;
};

export class DynamoPhotoRepository implements PhotoRepository {
  constructor(private readonly tableName: string, private readonly client: DynamoDBDocumentClient) {}

  async create(photo: Photo): Promise<Photo> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(photo) }));
    return photo;
  }

  async listByCar(ownerId: string, carId: string): Promise<Photo[]> {
    const res = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk(ownerId), ':sk': skPrefix(carId) },
    }));
    return (res.Items ?? []).map(toPhoto);
  }

  async getById(ownerId: string, carId: string, photoId: string): Promise<Photo | null> {
    const res = await this.client.send(new GetCommand({
      TableName: this.tableName, Key: { PK: pk(ownerId), SK: sk(carId, photoId) },
    }));
    return res.Item ? toPhoto(res.Item) : null;
  }

  async delete(ownerId: string, carId: string, photoId: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.tableName, Key: { PK: pk(ownerId), SK: sk(carId, photoId) },
    }));
  }
}
```

- [ ] **Step 4: Rewrite `apps/api/src/handler.ts` to build all deps**

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2,
} from 'aws-lambda';
import { DynamoCarRepository } from './dynamo-car-repository';
import { DynamoPhotoRepository } from './dynamo-photo-repository';
import { S3PhotoStorage } from './s3-photo-storage';
import { route, type ApiEvent, type RouteDeps } from './router';

const tableName = process.env.TABLE_NAME ?? '';
const photosBucket = process.env.PHOTOS_BUCKET ?? '';
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const deps: RouteDeps = {
  cars: new DynamoCarRepository(tableName, client),
  photos: new DynamoPhotoRepository(tableName, client),
  storage: new S3PhotoStorage(photosBucket, new S3Client({})),
};

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const apiEvent: ApiEvent = {
    method: event.requestContext.http.method,
    path: event.requestContext.http.path,
    ownerId: event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined ?? null,
    pathParams: event.pathParameters ? (event.pathParameters as Record<string, string>) : {},
    body: event.body ? JSON.parse(event.body) : null,
  };
  const result = await route(deps, apiEvent);
  return { statusCode: result.statusCode, headers: result.headers, body: result.body };
}
```

- [ ] **Step 5: Typecheck + lint + re-run api tests (router tests unaffected — use fakes)**

Run: `pnpm install && pnpm --filter @carlog/api typecheck && pnpm --filter @carlog/api lint && pnpm --filter @carlog/api test`
Expected: all PASS (11 api tests). The S3 adapter + Dynamo photo repo aren't unit-tested (AWS round-trip; verified live).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/s3-photo-storage.ts apps/api/src/dynamo-photo-repository.ts apps/api/src/handler.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): add S3 photo storage, Dynamo photo repo, and handler wiring"
```

---

### Task 6: CDK — PhotosBucket, CORS, env, grants, routes

**Files:**
- Modify: `infrastructure/cdk/lib/carlog-stack.ts`

**Interfaces:**
- Consumes: existing `fn` (CarsFn), `httpApi`, `integration`, `authorizer`, and `Bucket`/`HttpMethod` imports.
- Produces: a private `PhotosBucket`; `PHOTOS_BUCKET` env on the Lambda; S3 grants; two new HTTP API route registrations.

- [ ] **Step 1: Add `HttpMethod` + S3 imports if missing, and create the PhotosBucket**

`carlog-stack.ts` already imports `Bucket`, `BlockPublicAccess` and `HttpMethod`. Add the S3 CORS enums to the existing `aws-cdk-lib/aws-s3` import: `HttpMethods` and `Duration` (Duration is already imported). Update the import line:

```ts
import { BlockPublicAccess, Bucket, HttpMethods } from 'aws-cdk-lib/aws-s3';
```

After the existing `webBucket` definition, add:

```ts
    const photosBucket = new Bucket(this, 'PhotosBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [{
        allowedMethods: [HttpMethods.PUT, HttpMethods.GET],
        allowedOrigins: ['https://dkn291e7rr9st.cloudfront.net', 'http://localhost:5173'],
        allowedHeaders: ['*'],
        maxAge: 3000,
      }],
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(1) }],
    });
```

Note: the CloudFront origin `https://dkn291e7rr9st.cloudfront.net` is the deployed `WebUrl`. (If the distribution domain differs at deploy time, this is the value to reconcile — it matches the current live distribution.)

- [ ] **Step 2: Add `PHOTOS_BUCKET` env + grant S3 perms to the Lambda**

The `CarsFn` NodejsFunction already sets `environment: { TABLE_NAME: table.tableName }`. Change it to include the bucket, and add a grant after `table.grantReadWriteData(fn)`:

```ts
      environment: { TABLE_NAME: table.tableName, PHOTOS_BUCKET: photosBucket.bucketName },
```

and after the existing `table.grantReadWriteData(fn);`:

```ts
    photosBucket.grantReadWrite(fn); // s3:GetObject/PutObject/DeleteObject on this bucket only
```

(Define `photosBucket` BEFORE the `CarsFn` construct if ordering requires it — move the bucket definition above the `fn` definition so `photosBucket.bucketName` is available in the env. Keep the CORS/lifecycle config from Step 1.)

- [ ] **Step 3: Register the photo routes on the HTTP API**

After the existing two `httpApi.addRoutes(...)` calls, add:

```ts
    httpApi.addRoutes({ path: '/cars/{id}/photos', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/photos/presign', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/photos/{photoId}', methods: [HttpMethod.DELETE], integration, authorizer });
```

- [ ] **Step 4: Synth to verify the stack compiles and the bucket/routes/grants appear**

Run: `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk typecheck && AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk synth > /tmp/photos-synth.txt`
Then: `grep -cE 'PhotosBucket|PHOTOS_BUCKET|photos' /tmp/photos-synth.txt`
Expected: typecheck passes; synth succeeds; grep count > 0 (bucket + env present). Also confirm the template has the three new `AWS::ApiGatewayV2::Route` resources for the photos paths (`grep -c 'photos' /tmp/photos-synth.txt`).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/cdk/lib/carlog-stack.ts
git commit -m "feat(cdk): add private PhotosBucket with CORS, Lambda env/grants, and photo routes"
```

---

### Task 7: Web — validation helper, API client, query hooks

**Files:**
- Create: `apps/web/src/lib/validate-photo.ts`, `apps/web/src/lib/validate-photo.test.ts`
- Modify: `apps/web/src/api-client.ts`, `apps/web/src/queries.ts`

**Interfaces:**
- Consumes: `ALLOWED_PHOTO_TYPES`, `MAX_PHOTO_SIZE`, `MAX_PHOTOS_PER_CAR`, `Photo`, `PhotoWithUrl`, `PresignResponse` from `@carlog/contracts`; existing `request<T>` wrapper.
- Produces:
  - `validatePhotoFile(file: { type: string; size: number }, currentCount: number): string | null` (null = valid, else error message).
  - `presignPhoto`, `uploadToS3`, `confirmPhoto`, `listPhotos`, `deletePhoto`, `uploadPhoto` in api-client.
  - `usePhotos(carId)`, `useUploadPhoto(carId)`, `useDeletePhoto(carId)` hooks.

- [ ] **Step 1: Write the failing test — `apps/web/src/lib/validate-photo.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { validatePhotoFile } from './validate-photo';
import { MAX_PHOTO_SIZE, MAX_PHOTOS_PER_CAR } from '@carlog/contracts';

describe('validatePhotoFile', () => {
  it('accepts a valid jpeg under limits', () => {
    expect(validatePhotoFile({ type: 'image/jpeg', size: 1024 }, 0)).toBeNull();
  });
  it('rejects a non-image type', () => {
    expect(validatePhotoFile({ type: 'application/pdf', size: 1024 }, 0)).toMatch(/image/i);
  });
  it('rejects a file over the size limit', () => {
    expect(validatePhotoFile({ type: 'image/png', size: MAX_PHOTO_SIZE + 1 }, 0)).toMatch(/10 ?MB|large|size/i);
  });
  it('rejects when the per-car cap is reached', () => {
    expect(validatePhotoFile({ type: 'image/png', size: 1024 }, MAX_PHOTOS_PER_CAR)).toMatch(/limit|20/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/web test`
Expected: FAIL — cannot resolve `./validate-photo`.

- [ ] **Step 3: Create `apps/web/src/lib/validate-photo.ts`**

```ts
import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_SIZE, MAX_PHOTOS_PER_CAR } from '@carlog/contracts';

const isAllowed = (t: string): boolean => (ALLOWED_PHOTO_TYPES as readonly string[]).includes(t);

export function validatePhotoFile(file: { type: string; size: number }, currentCount: number): string | null {
  if (currentCount >= MAX_PHOTOS_PER_CAR) return `You can add at most ${MAX_PHOTOS_PER_CAR} photos per car.`;
  if (!isAllowed(file.type)) return 'Please choose an image (JPEG, PNG, WebP, or HEIC).';
  if (file.size > MAX_PHOTO_SIZE) return 'That image is larger than 10 MB.';
  if (file.size < 1) return 'That file is empty.';
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @carlog/web test`
Expected: PASS (existing resolveInstallMode 6 + 4 new validate-photo tests).

- [ ] **Step 5: Add photo functions to `apps/web/src/api-client.ts`**

Add the contracts imports and append these functions (reusing the existing `request` wrapper; a raw fetch for the S3 PUT). Add to the import from `@carlog/contracts`: `PhotoWithUrlSchema, PhotoSchema, PresignResponseSchema, type PhotoWithUrl, type PresignResponse, type PhotoContentType`. Then:

```ts
import { z } from 'zod'; // already imported at top; do not duplicate

const PhotoListSchema = z.array(PhotoWithUrlSchema);

export const presignPhoto = (token: string, carId: string, input: { contentType: PhotoContentType; size: number }): Promise<PresignResponse> =>
  request(token, `/cars/${carId}/photos/presign`, PresignResponseSchema, { method: 'POST', body: JSON.stringify(input) });

export async function uploadToS3(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!res.ok) throw new Error(`S3 upload ${res.status}`);
}

export const confirmPhoto = (token: string, carId: string, input: { contentType: PhotoContentType; size: number }) =>
  request(token, `/cars/${carId}/photos`, PhotoSchema, { method: 'POST', body: JSON.stringify(input) });

export const listPhotos = (token: string, carId: string): Promise<PhotoWithUrl[]> =>
  request(token, `/cars/${carId}/photos`, PhotoListSchema);

export const deletePhoto = (token: string, carId: string, photoId: string): Promise<void> =>
  request(token, `/cars/${carId}/photos/${photoId}`, PhotoSchema, { method: 'DELETE' }).then(() => undefined);

export async function uploadPhoto(token: string, carId: string, file: File): Promise<void> {
  const input = { contentType: file.type as PhotoContentType, size: file.size };
  const { uploadUrl } = await presignPhoto(token, carId, input);
  await uploadToS3(uploadUrl, file);
  await confirmPhoto(token, carId, input);
}
```

Note: `deletePhoto` passes `PhotoSchema` to `request` but the 204 path returns before parsing (same pattern as `deleteCar`).

- [ ] **Step 6: Add hooks to `apps/web/src/queries.ts`**

Add imports (`listPhotos`, `uploadPhoto`, `deletePhoto` from `./api-client`) and append:

```ts
export function usePhotos(carId: string) {
  const auth = useAuth();
  const token = auth.user?.access_token ?? '';
  return useQuery({
    queryKey: ['cars', carId, 'photos'],
    queryFn: () => listPhotos(token, carId),
    enabled: Boolean(token && carId),
  });
}

export function useUploadPhoto(carId: string) {
  const auth = useAuth();
  const token = auth.user?.access_token ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadPhoto(token, carId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'photos'] }),
  });
}

export function useDeletePhoto(carId: string) {
  const auth = useAuth();
  const token = auth.user?.access_token ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) => deletePhoto(token, carId, photoId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'photos'] }),
  });
}
```

- [ ] **Step 7: Typecheck + lint + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/validate-photo.ts apps/web/src/lib/validate-photo.test.ts apps/web/src/api-client.ts apps/web/src/queries.ts
git commit -m "feat(web): add photo validation, API client functions, and query hooks"
```

---

### Task 8: Web — PhotoGallery on the Vehicle page

**Files:**
- Create: `apps/web/src/components/PhotoGallery.tsx`
- Modify: `apps/web/src/routes/Vehicle.tsx`

**Interfaces:**
- Consumes: `usePhotos`, `useUploadPhoto`, `useDeletePhoto` (Task 7); `validatePhotoFile` (Task 7); existing `ConfirmDialog`, `StatusView`.
- Produces: `PhotoGallery({ carId }: { carId: string })`.

- [ ] **Step 1: Create `apps/web/src/components/PhotoGallery.tsx`**

```tsx
import { useRef, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, IconButton, ImageList, ImageListItem, Stack, Typography,
} from '@mui/material';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import DeleteIcon from '@mui/icons-material/Delete';
import { usePhotos, useUploadPhoto, useDeletePhoto } from '../queries';
import { validatePhotoFile } from '../lib/validate-photo';
import { ConfirmDialog } from './ConfirmDialog';
import { StatusView } from './ui/StatusView';

export function PhotoGallery({ carId }: { carId: string }) {
  const { data: photos, isLoading, isError } = usePhotos(carId);
  const upload = useUploadPhoto(carId);
  const del = useDeletePhoto(carId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const msg = validatePhotoFile({ type: file.type, size: file.size }, photos?.length ?? 0);
    if (msg) { setError(msg); return; }
    setError(null);
    try { await upload.mutateAsync(file); } catch { setError('Upload failed. Please try again.'); }
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h6">Photos</Typography>
        <Button startIcon={<AddPhotoAlternateIcon />} onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          Add photo
        </Button>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPick} />
      </Stack>
      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
      {upload.isPending ? <Box sx={{ mb: 2 }}><CircularProgress size={20} /></Box> : null}

      {isLoading ? (
        <StatusView state="loading" />
      ) : isError ? (
        <StatusView state="error" message="Could not load photos." />
      ) : !photos?.length ? (
        <Typography color="text.secondary">No photos yet.</Typography>
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
        title="Delete photo"
        message="Delete this photo? This can't be undone."
        onConfirm={async () => { if (toDelete) await del.mutateAsync(toDelete); setToDelete(null); }}
        onClose={() => setToDelete(null)}
        loading={del.isPending}
      />
    </Box>
  );
}
```

- [ ] **Step 2: Render `<PhotoGallery />` on the Vehicle page**

In `apps/web/src/routes/Vehicle.tsx`, import it:

```ts
import { PhotoGallery } from '../components/PhotoGallery';
```

Inside `VehicleDetail`, in the main `<Container>`, after the `</Card>` (the spec panel) and before the delete-error Alert, add:

```tsx
        <PhotoGallery carId={car.id} />
```

- [ ] **Step 3: Typecheck + lint + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/PhotoGallery.tsx apps/web/src/routes/Vehicle.tsx
git commit -m "feat(web): add PhotoGallery with upload, grid, lightbox, and delete on Vehicle page"
```

---

### Task 9: Full verification + deploy (backend + web)

**Files:** none (verification + deploy).

- [ ] **Step 1: Run all repo gates**

Run: `pnpm turbo run typecheck lint test`
Expected: all packages PASS — contracts (5 photo + prior), domain (2 photo + prior), api (11), web (validate-photo 4 + resolveInstallMode 6).

- [ ] **Step 2: Confirm the service worker still excludes the API/S3**

Run: `pnpm --filter @carlog/web build && grep -c 'execute-api' apps/web/dist/sw.js`
Expected: `0`.

- [ ] **Step 3: Deploy the backend (creates the PhotosBucket + new routes)**

Run: `AWS_PROFILE=yevhenii CDK_DEFAULT_REGION=us-east-1 pnpm --filter @carlog/cdk exec cdk deploy --require-approval never`
Expected: deploys; `PhotosBucket` created; the 3 photo routes added; Lambda env/grant updated. Note any output.

- [ ] **Step 4: Deploy the web app**

Run: `AWS_PROFILE=yevhenii ./scripts/deploy-web.sh`
Expected: builds, syncs, invalidates; prints the CloudFront URL.

- [ ] **Step 5: Live smoke test (definition of done)**

On the deployed app, signed in, on a car's detail page:
1. Add photo (desktop file or phone camera/library) → it appears in the grid.
2. Reload → the photo persists.
3. Try an image > 10 MB → rejected with a clear message (client blocks it; if bypassed, server 400/PUT rejects on content-length).
4. Add up to 20, then the 21st presign → rejected (409 / client message).
5. Tap a photo → lightbox opens full-size.
6. Delete a photo (confirm) → it disappears and stays gone after reload.
7. Copy a photo's `src` URL, strip the query string (signature), open it → **403** (bucket private).
8. Network tab: `/cars/{id}/photos` calls and the S3 PUT/GET hit the network, not the service worker.

Expected: all pass.

---

## Self-Review Notes

- **Spec coverage:** contracts+model → Task 1; domain ports/factory → Task 2; pure helpers+fake → Task 3; routes+router+error mapping → Task 4; S3/Dynamo adapters+handler → Task 5; CDK bucket/CORS/env/grants/routes → Task 6; web validation/client/hooks → Task 7; gallery UI → Task 8; verify+deploy → Task 9. All spec layers mapped.
- **Uploads bypass Lambda:** the browser PUTs directly to S3 via the presigned URL (Task 7 `uploadToS3`); Lambda only presigns/confirms/lists/deletes. Satisfied.
- **Private bucket / IDOR:** bucket is `BLOCK_ALL`; every handler derives `ownerId` from the JWT and scopes car lookup + Dynamo keys + S3 key prefix to it (Task 4 `requireCar`, `photoKey`); Task 9 Step 7 verifies the 403.
- **No `any`; extensionless imports; Zod source of truth (z.infer); MUI-only frontend** — enforced per task via typecheck+lint gates.
- **Router signature change** (`route(repo,event)` → `route(deps,event)`) is contained: Task 4 updates `router.test.ts`'s car calls in the same commit, and Task 5 updates `handler.ts`. Car routes now match exact `path === '/cars/${id}'` so photo sub-paths can't be swallowed by the car GET/PUT/DELETE branch — a real bug this guards against.
- **Type consistency:** `PhotoRepository`/`PhotoStorage` port method signatures (Task 2) are used identically by the fakes (Task 3), routes (Task 4), and Dynamo/S3 impls (Task 5); `RouteDeps` shape is consistent across router (4), handler (5), and tests (4); contracts consts (`MAX_PHOTO_SIZE` etc.) used verbatim in domain, api, and web.
- **SW guard:** Task 9 Step 2 re-asserts `execute-api == 0` after the web build so photo work can't regress the service worker.
- **deleteCar/deletePhoto pattern:** `deletePhoto` reuses the `.then(() => undefined)` 204 pattern already established for `deleteCar`.
- **CORS origin:** the PhotosBucket CORS `allowedOrigins` uses the live CloudFront domain `https://dkn291e7rr9st.cloudfront.net` + localhost; flagged in Task 6 Step 1 as the value to reconcile if the distribution domain ever changes.
