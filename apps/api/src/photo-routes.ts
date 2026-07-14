import { PresignRequestSchema, ConfirmRequestSchema } from '@carlog/contracts';
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
    const { photoId, ...req } = ConfirmRequestSchema.parse(body);
    const existing = await deps.photos.listByCar(ownerId, carId);
    assertUnderCap(existing.length);
    if (!(await deps.storage.exists(photoKey(ownerId, carId, photoId)))) throw new PhotoNotFoundError(photoId);
    const photo = createPhoto(ownerId, carId, req, { newId: () => photoId });
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
