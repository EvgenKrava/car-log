import { describe, expect, it } from 'vitest';
import type { Car } from '@carlog/contracts';
import { InMemoryCarRepository } from './in-memory-car-repository';

const mkCar = (ownerId: string, id: string): Car => ({
  id,
  ownerId,
  make: 'Toyota',
  model: 'Corolla',
  year: 2020,
  mileage: 45000,
  fuelType: 'petrol',
  nickname: undefined,
  vin: undefined,
  licensePlate: undefined,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  shared: false,
});

describe('InMemoryCarRepository', () => {
  it('setShared writes/removes the share index', async () => {
    const repo = new InMemoryCarRepository();
    await repo.create(mkCar('u1', 'c1'));
    expect(await repo.findSharedOwnerId('c1')).toBeNull();
    await repo.setShared('u1', 'c1', true);
    expect(await repo.findSharedOwnerId('c1')).toBe('u1');
    expect((await repo.getById('u1', 'c1'))!.shared).toBe(true);
    await repo.setShared('u1', 'c1', false);
    expect(await repo.findSharedOwnerId('c1')).toBeNull();
  });
});