import { describe, it, expect } from 'vitest';
import { toPublicCar } from './to-public-car';

describe('toPublicCar', () => {
  it('maps allowed fields and drops owner data', () => {
    const car = {
      id: 'c1',
      ownerId: 'secret',
      make: 'M',
      model: 'G',
      year: 2008,
      fuelType: 'petrol',
      mileage: 100,
      vin: 'V',
      licensePlate: 'P',
      shared: true,
      createdAt: 'x',
      updatedAt: 'y',
    } as never;
    const events = [
      {
        id: 'e1',
        ownerId: 'secret',
        carId: 'c1',
        date: '2026-01-01',
        category: 'oil_change',
        mileage: 100,
        cost: 50,
        currency: 'UAH',
        works: [],
        createdAt: 'x',
        updatedAt: 'y',
      },
    ] as never;
    const pc = toPublicCar(car, events);
    expect(JSON.stringify(pc)).not.toContain('secret');
    expect(JSON.stringify(pc)).not.toContain('ownerId');
    expect(JSON.stringify(pc)).not.toContain('createdAt');
    expect(JSON.stringify(pc)).not.toContain('updatedAt');
    expect(pc).toMatchObject({
      make: 'M',
      vin: 'V',
      events: [{ id: 'e1', cost: 50 }],
    });
  });
});