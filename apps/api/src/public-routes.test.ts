import { describe, it, expect, beforeEach } from 'vitest';
import { handlePublicRoute } from './public-routes';
import { InMemoryCarRepository } from './in-memory-car-repository';
import { InMemoryEventRepository } from './in-memory-event-repository';
import type { ApiEvent } from './router';

const carBody = { make: 'Toyota', model: 'Corolla', year: 2020, mileage: 45000, fuelType: 'petrol' } as const;
const eventBody = {
  date: '2026-07-01', mileage: 45000, cost: 500, category: 'oil_change' as const,
  works: [{ description: 'Oil change', parts: [] }],
};

let cars: InMemoryCarRepository;
let events: InMemoryEventRepository;

beforeEach(() => {
  cars = new InMemoryCarRepository();
  events = new InMemoryEventRepository();
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
    const result = await handlePublicRoute({ cars, events }, makeEvent({ path: '/cars' }));
    expect(result).toBeUndefined();
  });

  it('404s for an unknown car id', async () => {
    const result = await handlePublicRoute(
      { cars, events },
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
      { cars, events },
      makeEvent({ path: `/public/cars/${created.id}`, pathParams: { carId: created.id } }),
    );
    expect(result?.statusCode).toBe(404);
  });

  it('returns a sanitized DTO for a shared car', async () => {
    const created = await cars.create({
      id: 'c1', ownerId: 'u1', ...carBody, shared: false,
      createdAt: 'x', updatedAt: 'x',
    } as never);
    await cars.setShared('u1', created.id, true);

    const ev = await events.create({
      id: 'e1', ownerId: 'u1', carId: created.id, ...eventBody, currency: 'UAH',
      createdAt: 'x', updatedAt: 'x',
    } as never);

    const result = await handlePublicRoute(
      { cars, events },
      makeEvent({ path: `/public/cars/${created.id}`, pathParams: { carId: created.id } }),
    );
    expect(result?.statusCode).toBe(200);
    const body = JSON.parse(result?.body ?? '{}');
    expect(body.ownerId).toBeUndefined();
    expect(body.id).toBe(created.id);
    expect(body.make).toBe('Toyota');
    expect(body.events).toHaveLength(1);
    expect(body.events[0].id).toBe(ev.id);
    expect(body.events[0].ownerId).toBeUndefined();
    expect(body.events[0].proofs).toBeUndefined();
  });

  it('404s a GET with no carId path param', async () => {
    const result = await handlePublicRoute(
      { cars, events },
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
      { cars, events },
      makeEvent({ method: 'DELETE', path: `/public/cars/${created.id}`, pathParams: { carId: created.id } }),
    );
    expect(result?.statusCode).toBe(404);
  });
});