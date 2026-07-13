import { describe, expect, it } from 'vitest';
import { createCar } from './car';

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
});
