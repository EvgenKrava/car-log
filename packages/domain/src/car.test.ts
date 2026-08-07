import { describe, expect, it } from 'vitest';
import { createCar, bumpCarMileage } from './car';

const input = { make: 'Toyota', model: 'Corolla', year: 2020, mileage: 45000, fuelType: 'petrol' as const };
const deps = { newId: () => 'fixed-id', now: () => '2026-07-13T00:00:00.000Z' };

describe('createCar', () => {
  it('assigns id, ownerId and timestamps', () => {
    const car = createCar('user-1', input, deps);
    expect(car).toMatchObject({
      id: 'fixed-id', ownerId: 'user-1', make: 'Toyota',
      createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
    });
  });

  it('rejects invalid input (bad year)', () => {
    expect(() => createCar('user-1', { ...input, year: 1800 }, deps)).toThrow();
  });

  it('stamps mileageUpdatedAt = createdAt', () => {
    const car = createCar('o', { make: 'VW', model: 'Golf', year: 2018, mileage: 1, fuelType: 'diesel' }, { now: () => '2026-08-07T00:00:00.000Z' });
    expect(car.mileageUpdatedAt).toBe('2026-08-07T00:00:00.000Z');
  });
});

describe('bumpCarMileage', () => {
  const car = {
    id: '33333333-3333-4333-8333-333333333333', ownerId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    mileageUpdatedAt: '2026-01-01T00:00:00.000Z',
    make: 'Toyota', model: 'Corolla', year: 2020, mileage: 50000, fuelType: 'petrol' as const,
    nickname: undefined, vin: undefined, licensePlate: undefined, shared: false,
  };
  it('returns update input when the new mileage is higher', () => {
    expect(bumpCarMileage(car, 51000)).toMatchObject({ make: 'Toyota', mileage: 51000 });
  });
  it('returns null when equal or lower', () => {
    expect(bumpCarMileage(car, 50000)).toBeNull();
    expect(bumpCarMileage(car, 49999)).toBeNull();
  });

  it('carries a fresh mileageUpdatedAt when bumping', () => {
    const bumped = bumpCarMileage(car, 200000, () => '2026-08-07T00:00:00.000Z');
    expect(bumped?.mileageUpdatedAt).toBe('2026-08-07T00:00:00.000Z');
    expect(bumpCarMileage(car, 100, () => 'x')).toBeNull(); // not newer → no bump, now() unused
  });
});
