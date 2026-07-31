import type { CarRepository, EventRepository, ProofRepository, PhotoStorage } from '@carlog/domain';
import { ok, type ApiResult } from './errors';
import { proofKey } from './event-key';
import type { ApiEvent } from './router';
import { toPublicCar } from './to-public-car';

export type PublicDeps = {
  cars: CarRepository; events: EventRepository; proofs: ProofRepository; storage: PhotoStorage;
};

// Handles /public/cars/{carId} — unauthenticated. Returns undefined for non-matching paths.
export async function handlePublicRoute(deps: PublicDeps, event: ApiEvent): Promise<ApiResult | undefined> {
  const { method, path, pathParams } = event;
  if (!path.startsWith('/public/cars/')) return undefined;
  const carId = pathParams.carId;
  if (method !== 'GET' || !carId) return ok(404, { error: 'Not found' });

  const ownerId = await deps.cars.findSharedOwnerId(carId);
  if (!ownerId) return ok(404, { error: 'Not found' });
  const car = await deps.cars.getById(ownerId, carId);
  if (!car || !car.shared) return ok(404, { error: 'Not found' });

  const events = await deps.events.listByCar(ownerId, carId);
  const withProofs = await Promise.all(events.map(async (e) => {
    const proofs = await deps.proofs.listByEvent(ownerId, carId, e.id);
    const signed = await Promise.all(proofs.map(async (p) => ({
      url: await deps.storage.presignGet(proofKey(ownerId, carId, e.id, p.id)),
      contentType: p.contentType,
      filename: p.filename,
    })));
    return { ...e, proofs: signed };
  }));
  return ok(200, toPublicCar(car, withProofs));
}
