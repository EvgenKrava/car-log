import { CreateEventSchema, ProofConfirmSchema, ProofPresignRequestSchema, MAX_PROOF_SIZE, FromScanProofSchema, type Car } from '@carlog/contracts';
import {
  CarNotFoundError, EventNotFoundError, ProofNotFoundError, createEvent, bumpCarMileage,
  type EventRepository, type ProofRepository, type PhotoStorage, type CarRepository,
} from '@carlog/domain';
import { ok, type ApiResult } from './errors';
import { proofKey, assertProofUnderCap } from './event-key';
import type { ApiEvent } from './router';

export type EventDeps = {
  cars: CarRepository; events: EventRepository; proofs: ProofRepository; storage: PhotoStorage;
};

async function requireCar(deps: EventDeps, ownerId: string, carId: string): Promise<Car> {
  const car = await deps.cars.getById(ownerId, carId);
  if (!car) throw new CarNotFoundError(carId);
  return car;
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
    if (path === `${pbase}/from-scan` && method === 'POST') {
      const req = FromScanProofSchema.parse(body);
      if (!req.s3Key.startsWith(`scans/${ownerId}/`)) return ok(400, { error: 'ValidationError', message: 'invalid s3Key' });
      const existing = await deps.proofs.listByEvent(ownerId, carId, eventId);
      assertProofUnderCap(existing.length);
      if (!(await deps.storage.exists(req.s3Key))) throw new ProofNotFoundError('scan');
      const newProofId = crypto.randomUUID();
      const destKey = proofKey(ownerId, carId, eventId, newProofId);
      await deps.storage.copyObject(req.s3Key, destKey);
      const proof = {
        id: newProofId, eventId, carId, ownerId,
        contentType: req.contentType, size: req.size, filename: undefined,
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
    const car = await requireCar(deps, ownerId, carId);
    const ev = createEvent(ownerId, carId, CreateEventSchema.parse(body));
    const created = await deps.events.create(ev);
    // Odometer readings on events keep the car's mileage current (spec: mileage auto-update).
    const bumped = bumpCarMileage(car, ev.mileage);
    if (bumped) await deps.cars.update(ownerId, carId, bumped);
    return ok(201, created);
  }
  if (eventId && path === `${base}/${eventId}` && method === 'GET') {
    await requireCar(deps, ownerId, carId);
    const ev = await deps.events.getById(ownerId, carId, eventId);
    if (!ev) throw new EventNotFoundError(eventId);
    return ok(200, ev);
  }
  if (eventId && path === `${base}/${eventId}` && method === 'PUT') {
    const car = await requireCar(deps, ownerId, carId);
    await requireEvent(deps, ownerId, carId, eventId);
    const input = CreateEventSchema.parse(body);
    const updated = await deps.events.update(ownerId, carId, eventId, input);
    const bumped = bumpCarMileage(car, input.mileage);
    if (bumped) await deps.cars.update(ownerId, carId, bumped);
    return ok(200, updated);
  }
  if (eventId && path === `${base}/${eventId}` && method === 'DELETE') {
    await requireCar(deps, ownerId, carId);
    // Cascade: delete proof objects + rows first, then the event — so an interrupted
    // delete never leaves proof rows under a missing event, and the whole op is
    // safe to retry (S3 DeleteObject is idempotent). Narrow window: if proofs.delete
    // throws after a successful deleteObject, that one S3 object is orphaned; a retry
    // of the whole delete cleans it up.
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
