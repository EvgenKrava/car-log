import { CreateEventSchema, ProofConfirmSchema, ProofPresignRequestSchema, MAX_PROOF_SIZE } from '@carlog/contracts';
import {
  CarNotFoundError, EventNotFoundError, ProofNotFoundError, createEvent,
  type EventRepository, type ProofRepository, type PhotoStorage, type CarRepository,
} from '@carlog/domain';
import { ok, type ApiResult } from './errors';
import { proofKey, assertProofUnderCap } from './event-key';
import type { ApiEvent } from './router';

export type EventDeps = {
  cars: CarRepository; events: EventRepository; proofs: ProofRepository; storage: PhotoStorage;
};

async function requireCar(deps: EventDeps, ownerId: string, carId: string) {
  const car = await deps.cars.getById(ownerId, carId);
  if (!car) throw new CarNotFoundError(carId);
}

async function requireEvent(deps: EventDeps, ownerId: string, carId: string, eventId: string) {
  const ev = await deps.events.getById(ownerId, carId, eventId);
  if (!ev) throw new EventNotFoundError(eventId);
}

// Handles /cars/{carId}/events* ; returns null if not matched.
export async function handleEventRoute(
  deps: EventDeps, event: ApiEvent, ownerId: string, carId: string,
): Promise<ApiResult | null> {
  const { method, path, pathParams, body } = event;
  const base = `/cars/${carId}/events`;
  const eventId = pathParams.eventId;
  const proofId = pathParams.proofId;

  // Proof sub-routes (checked before the event-item routes)
  if (eventId && path.startsWith(`${base}/${eventId}/proofs`)) {
    await requireCar(deps, ownerId, carId);
    await requireEvent(deps, ownerId, carId, eventId);
    const pbase = `${base}/${eventId}/proofs`;

    if (path === `${pbase}/presign` && method === 'POST') {
      const req = ProofPresignRequestSchema.parse(body);
      const existing = await deps.proofs.listByEvent(ownerId, carId, eventId);
      assertProofUnderCap(existing.length);
      const newProofId = crypto.randomUUID();
      const key = proofKey(ownerId, carId, eventId, newProofId);
      const uploadUrl = await deps.storage.presignPut(key, req.contentType, MAX_PROOF_SIZE);
      return ok(200, { proofId: newProofId, uploadUrl, key });
    }
    if (path === pbase && method === 'POST') {
      const req = ProofConfirmSchema.parse(body);
      const existing = await deps.proofs.listByEvent(ownerId, carId, eventId);
      assertProofUnderCap(existing.length);
      const key = proofKey(ownerId, carId, eventId, req.proofId);
      if (!(await deps.storage.exists(key))) throw new ProofNotFoundError(req.proofId);
      const proof = {
        id: req.proofId, eventId, carId, ownerId,
        contentType: req.contentType, size: req.size, filename: req.filename,
        createdAt: new Date().toISOString(),
      };
      return ok(201, await deps.proofs.create(proof));
    }
    if (path === pbase && method === 'GET') {
      const proofs = await deps.proofs.listByEvent(ownerId, carId, eventId);
      const withUrls = await Promise.all(
        proofs.map(async (p) => ({ ...p, url: await deps.storage.presignGet(proofKey(ownerId, carId, eventId, p.id)) })),
      );
      return ok(200, withUrls);
    }
    if (proofId && path === `${pbase}/${proofId}` && method === 'DELETE') {
      const proof = await deps.proofs.getById(ownerId, carId, eventId, proofId);
      if (!proof) throw new ProofNotFoundError(proofId);
      await deps.storage.deleteObject(proofKey(ownerId, carId, eventId, proofId));
      await deps.proofs.delete(ownerId, carId, eventId, proofId);
      return ok(204, null);
    }
    return null;
  }

  // Event-item routes
  if (path === base && method === 'GET') {
    await requireCar(deps, ownerId, carId);
    return ok(200, await deps.events.listByCar(ownerId, carId));
  }
  if (path === base && method === 'POST') {
    await requireCar(deps, ownerId, carId);
    const ev = createEvent(ownerId, carId, CreateEventSchema.parse(body));
    return ok(201, await deps.events.create(ev));
  }
  if (eventId && path === `${base}/${eventId}` && method === 'GET') {
    await requireCar(deps, ownerId, carId);
    const ev = await deps.events.getById(ownerId, carId, eventId);
    if (!ev) throw new EventNotFoundError(eventId);
    return ok(200, ev);
  }
  if (eventId && path === `${base}/${eventId}` && method === 'PUT') {
    await requireCar(deps, ownerId, carId);
    await requireEvent(deps, ownerId, carId, eventId);
    return ok(200, await deps.events.update(ownerId, carId, eventId, CreateEventSchema.parse(body)));
  }
  if (eventId && path === `${base}/${eventId}` && method === 'DELETE') {
    await requireCar(deps, ownerId, carId);
    // Cascade: delete proof objects + rows, then the event.
    const proofs = await deps.proofs.listByEvent(ownerId, carId, eventId);
    for (const p of proofs) {
      await deps.storage.deleteObject(proofKey(ownerId, carId, eventId, p.id));
      await deps.proofs.delete(ownerId, carId, eventId, p.id);
    }
    await deps.events.delete(ownerId, carId, eventId);
    return ok(204, null);
  }
  return null;
}
