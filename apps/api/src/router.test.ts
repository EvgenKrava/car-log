import { beforeEach, describe, expect, it } from 'vitest';
import { route } from './router';
import { InMemoryCarRepository } from './in-memory-car-repository';

let repo: InMemoryCarRepository;
beforeEach(() => { repo = new InMemoryCarRepository(); });

const base = { pathParams: {}, body: null } as const;
const validBody = { make: 'Toyota', model: 'Corolla', year: 2020, mileage: 45000, fuelType: 'petrol' };

describe('route', () => {
  it('POST /cars creates a car scoped to the owner', async () => {
    const res = await route(repo, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: validBody });
    expect(res.statusCode).toBe(201);
    const car = JSON.parse(res.body);
    expect(car).toMatchObject({ make: 'Toyota', ownerId: 'u1' });
    expect(car.id).toBeDefined();
  });

  it('GET /cars lists only the owner cars', async () => {
    await route(repo, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: validBody });
    await route(repo, { ...base, method: 'POST', path: '/cars', ownerId: 'u2', body: validBody });
    const res = await route(repo, { ...base, method: 'GET', path: '/cars', ownerId: 'u1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveLength(1);
  });

  it('returns 400 on invalid body', async () => {
    const res = await route(repo, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: { make: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 when ownerId is missing', async () => {
    const res = await route(repo, { ...base, method: 'GET', path: '/cars', ownerId: null });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 deleting a missing car', async () => {
    const res = await route(repo, { ...base, method: 'DELETE', path: '/cars/nope', ownerId: 'u1', pathParams: { id: 'nope' } });
    expect(res.statusCode).toBe(404);
  });
});
