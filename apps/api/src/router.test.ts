import { beforeEach, describe, expect, it } from 'vitest';
import { route } from './router';
import { InMemoryCarRepository } from './in-memory-car-repository';
import { InMemoryPhotoRepository } from './in-memory-photo-repository';
import { InMemoryEventRepository } from './in-memory-event-repository';
import { InMemoryProofRepository } from './in-memory-proof-repository';
import type { PhotoStorage } from '@carlog/domain';

let cars: InMemoryCarRepository;
let photos: InMemoryPhotoRepository;
const storage: PhotoStorage = {
  presignPut: async () => 'https://s3.example/put',
  presignGet: async () => 'https://s3.example/get',
  deleteObject: async () => {},
  exists: async () => true,
};
let deps: { cars: InMemoryCarRepository; photos: InMemoryPhotoRepository; storage: PhotoStorage; events: InMemoryEventRepository; proofs: InMemoryProofRepository };
beforeEach(() => {
  cars = new InMemoryCarRepository();
  photos = new InMemoryPhotoRepository();
  deps = {
    cars, photos, storage,
    events: new InMemoryEventRepository(),
    proofs: new InMemoryProofRepository(),
  };
});

const base = { pathParams: {}, body: null } as const;
const validBody = { make: 'Toyota', model: 'Corolla', year: 2020, mileage: 45000, fuelType: 'petrol' };

describe('route', () => {
  it('POST /cars creates a car scoped to the owner', async () => {
    const res = await route(deps, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: validBody });
    expect(res.statusCode).toBe(201);
    const car = JSON.parse(res.body);
    expect(car).toMatchObject({ make: 'Toyota', ownerId: 'u1' });
    expect(car.id).toBeDefined();
  });

  it('GET /cars lists only the owner cars', async () => {
    await route(deps, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: validBody });
    await route(deps, { ...base, method: 'POST', path: '/cars', ownerId: 'u2', body: validBody });
    const res = await route(deps, { ...base, method: 'GET', path: '/cars', ownerId: 'u1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveLength(1);
  });

  it('returns 400 on invalid body', async () => {
    const res = await route(deps, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: { make: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 when ownerId is missing', async () => {
    const res = await route(deps, { ...base, method: 'GET', path: '/cars', ownerId: null });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 deleting a missing car', async () => {
    const res = await route(deps, { ...base, method: 'DELETE', path: '/cars/nope', ownerId: 'u1', pathParams: { id: 'nope' } });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /cars/{id} clears an omitted optional field (full replace)', async () => {
    const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: { ...validBody, vin: '1HGCM82633A004352' } })).body);
    const res = await route(deps, { ...base, method: 'PUT', path: `/cars/${created.id}`, ownerId: 'u1', pathParams: { id: created.id }, body: validBody });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).vin).toBeUndefined();
  });

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
      const photoId = crypto.randomUUID();
      const created = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/photos`, ownerId: 'u1', pathParams: { id: carId }, body: { ...img, photoId } });
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
        const photoId = crypto.randomUUID();
        await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/photos`, ownerId: 'u1', pathParams: { id: carId }, body: { ...img, photoId } });
      }
      const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/photos/presign`, ownerId: 'u1', pathParams: { id: carId }, body: img });
      expect(res.statusCode).toBe(409);
    });

    it('delete removes a photo (404 when missing)', async () => {
      const carId = await makeCar('u1');
      const photoId = crypto.randomUUID();
      const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/photos`, ownerId: 'u1', pathParams: { id: carId }, body: { ...img, photoId } })).body);
      const del = await route(deps, { ...base, method: 'DELETE', path: `/cars/${carId}/photos/${created.id}`, ownerId: 'u1', pathParams: { id: carId, photoId: created.id } });
      expect(del.statusCode).toBe(204);
      const missing = await route(deps, { ...base, method: 'DELETE', path: `/cars/${carId}/photos/${created.id}`, ownerId: 'u1', pathParams: { id: carId, photoId: created.id } });
      expect(missing.statusCode).toBe(404);
    });
  });

  describe('event routes', () => {
    const ev = { date: '2026-07-14', mileage: 1000, cost: 500, category: 'oil_change', works: [{ description: 'Oil change', parts: [{ name: 'Filter', quantity: 1 }] }] };

    async function makeCar(ownerId: string) {
      const res = await route(deps, { ...base, method: 'POST', path: '/cars', ownerId, body: validBody });
      return JSON.parse(res.body).id as string;
    }

    it('creates and lists events for the owner car', async () => {
      const carId = await makeCar('u1');
      const created = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId }, body: ev });
      expect(created.statusCode).toBe(201);
      const list = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId } });
      expect(list.statusCode).toBe(200);
      const arr = JSON.parse(list.body);
      expect(arr).toHaveLength(1);
      expect(arr[0].works[0].parts[0].name).toBe('Filter');
    });

    it('event list excludes proof rows (collision guard)', async () => {
      const carId = await makeCar('u1');
      const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId }, body: ev })).body);
      // confirm a proof for the event
      await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events/${created.id}/proofs`, ownerId: 'u1', pathParams: { id: carId, eventId: created.id }, body: { proofId: '99999999-9999-9999-9999-999999999999', contentType: 'application/pdf', size: 1024 } });
      const list = JSON.parse((await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId } })).body);
      expect(list).toHaveLength(1); // only the event, not the proof
      expect(list[0].works).toBeDefined();
    });

    it('404s an event on a car the caller does not own', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/events`, ownerId: 'u2', pathParams: { id: carId } });
      expect(res.statusCode).toBe(404);
    });

    it('deleting an event cascade-deletes its proofs', async () => {
      const carId = await makeCar('u1');
      const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId }, body: ev })).body);
      await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events/${created.id}/proofs`, ownerId: 'u1', pathParams: { id: carId, eventId: created.id }, body: { proofId: '88888888-8888-8888-8888-888888888888', contentType: 'application/pdf', size: 1024 } });
      const del = await route(deps, { ...base, method: 'DELETE', path: `/cars/${carId}/events/${created.id}`, ownerId: 'u1', pathParams: { id: carId, eventId: created.id } });
      expect(del.statusCode).toBe(204);
      const proofs = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/events/${created.id}/proofs`, ownerId: 'u1', pathParams: { id: carId, eventId: created.id } });
      // event is gone -> requireEvent throws 404
      expect(proofs.statusCode).toBe(404);
    });
  });
});
