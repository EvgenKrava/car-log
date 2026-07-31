import { describe, it, expect, beforeEach } from 'vitest';
import { handlePublicRoute } from './public-routes';
import { InMemoryCarRepository } from './in-memory-car-repository';
import { InMemoryEventRepository } from './in-memory-event-repository';
import { InMemoryProofRepository } from './in-memory-proof-repository';
import type { ApiEvent } from './router';
import type { PhotoStorage } from '@carlog/domain';

const carBody = { make: 'Toyota', model: 'Corolla', year: 2020, mileage: 45000, fuelType: 'petrol' } as const;
const eventBody = {
  date: '2026-07-01', mileage: 45000, cost: 500, category: 'oil_change' as const,
  works: [{ description: 'Oil change', parts: [] }],
};

const storage: PhotoStorage = {
  presignPut: async () => 'https://s3.example/put',
  presignGet: async (key: string) => `https://s3.example/get?key=${key}`,
  deleteObject: async () => {},
  exists: async () => true,
  copyObject: async () => {},
};

let cars: InMemoryCarRepository;
let events: InMemoryEventRepository;
let proofs: InMemoryProofRepository;

beforeEach(() => {
  cars = new InMemoryCarRepository();
  events = new InMemoryEventRepository();
  proofs = new InMemoryProofRepository();
});

function makeEvent(overrides: Partial<ApiEvent>): ApiEvent {
  return {
    method: 'GET', path: '/public/cars/nope', ownerId: null, groups: [],
    pathParams: {}, queryParams: {}, body: null,
    ...overrides,
  };
}

describe('handlePublicRoute', () => {
  it('returns undefined for non-public paths', async () => {
    const result = await handlePublicRoute({ cars, events, proofs, storage }, makeEvent({ path: '/cars' }));
    expect(result).toBeUndefined();
  });

  it('404s for an unknown car id', async () => {
    const result = await handlePublicRoute(
      { cars, events, proofs, storage },
      makeEvent({ path: '/public/cars/unknown', pathParams: { carId: 'unknown' } }),
    );
    expect(result?.statusCode).toBe(404);
  });

  it('404s for a car that exists but is not shared', async () => {
    const created = await cars.create({
      id: 'c1', ownerId: 'u1', ...carBody, shared: false,
      createdAt: 'x', updatedAt: 'x',
    } as never);
    const result = await handlePublicRoute(
      { cars, events, proofs, storage },
      makeEvent({ path: `/public/cars/${created.id}`, pathParams: { carId: created.id } }),
    );
    expect(result?.statusCode).toBe(404);
  });

  it('returns a sanitized DTO with signed proof urls for a shared car', async () => {
    const created = await cars.create({
      id: 'c1', ownerId: 'u1', ...carBody, shared: false,
      createdAt: 'x', updatedAt: 'x',
    } as never);
    await cars.setShared('u1', created.id, true);

    const ev = await events.create({
      id: 'e1', ownerId: 'u1', carId: created.id, ...eventBody, currency: 'UAH',
      createdAt: 'x', updatedAt: 'x',
    } as never);
    await proofs.create({
      id: 'p1', ownerId: 'u1', carId: created.id, eventId: ev.id,
      contentType: 'image/jpeg', size: 1024, filename: 'receipt.jpg', createdAt: 'x',
    });

    const result = await handlePublicRoute(
      { cars, events, proofs, storage },
      makeEvent({ path: `/public/cars/${created.id}`, pathParams: { carId: created.id } }),
    );
    expect(result?.statusCode).toBe(200);
    const body = JSON.parse(result?.body ?? '{}');
    expect(body.ownerId).toBeUndefined();
    expect(body.id).toBe(created.id);
    expect(body.make).toBe('Toyota');
    expect(body.events).toHaveLength(1);
    expect(body.events[0].id).toBe('e1');
    expect(body.events[0].ownerId).toBeUndefined();
    expect(body.events[0].proofs).toHaveLength(1);
    expect(body.events[0].proofs[0].url).toContain('https://s3.example/get?key=proofs/u1/');
    expect(body.events[0].proofs[0].filename).toBe('receipt.jpg');
  });

  it('404s a GET with no carId path param', async () => {
    const result = await handlePublicRoute(
      { cars, events, proofs, storage },
      makeEvent({ path: '/public/cars/', pathParams: {} }),
    );
    expect(result?.statusCode).toBe(404);
  });

  it('404s a non-GET method on the public car route', async () => {
    const created = await cars.create({
      id: 'c1', ownerId: 'u1', ...carBody, shared: true,
      createdAt: 'x', updatedAt: 'x',
    } as never);
    await cars.setShared('u1', created.id, true);
    const result = await handlePublicRoute(
      { cars, events, proofs, storage },
      makeEvent({ method: 'DELETE', path: `/public/cars/${created.id}`, pathParams: { carId: created.id } }),
    );
    expect(result?.statusCode).toBe(404);
  });
});
