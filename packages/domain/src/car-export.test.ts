import { describe, expect, it } from 'vitest';
import type { Car, Event, Reminder } from '@carlog/contracts';
import { CarExportSchema } from '@carlog/contracts';
import { toCarExport } from './car-export';

const car: Car = {
  id: 'car-1', ownerId: 'owner-secret', make: 'VW', model: 'Golf', year: 2018,
  mileage: 92000, fuelType: 'diesel', engineVolume: 2, nickname: 'Wolfie',
  vin: 'WVWZZZ1KZAW000001', licensePlate: 'AA1234BB',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', shared: true,
};

const events: Event[] = [
  {
    id: 'e-old', carId: 'car-1', ownerId: 'owner-secret', date: '2023-06-01',
    category: 'oil_change', mileage: 70000, cost: 1200, currency: 'UAH',
    title: 'Oil', notes: undefined,
    works: [{ description: 'Oil & filter', parts: [{ name: '5W-30', quantity: 5 }] }],
    createdAt: '2023-06-01T00:00:00.000Z', updatedAt: '2023-06-01T00:00:00.000Z',
  },
  {
    id: 'e-new', carId: 'car-1', ownerId: 'owner-secret', date: '2024-02-01',
    category: 'brakes', mileage: 84000, cost: 3000, currency: 'UAH',
    title: undefined, notes: undefined, works: [],
    createdAt: '2024-02-01T00:00:00.000Z', updatedAt: '2024-02-01T00:00:00.000Z',
  },
];

const reminders: Reminder[] = [{
  id: 'r1', carId: 'car-1', ownerId: 'owner-secret', title: 'Timing belt',
  category: 'repair', dueMileage: 120000, notes: undefined,
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
}];

const AT = '2026-08-06T10:00:00.000Z';

describe('toCarExport', () => {
  it('produces a file that parses against the contract (round-trip)', () => {
    const file = toCarExport(car, events, reminders, AT);
    const parsed = CarExportSchema.parse(file);
    expect(parsed.car.make).toBe('VW');
    expect(parsed.car.mileage).toBe(92000);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.reminders[0]!.dueMileage).toBe(120000);
    expect(parsed.exportedAt).toBe(AT);
  });

  it('never leaks server-owned fields — asserted by value', () => {
    const json = JSON.stringify(toCarExport(car, events, reminders, AT));
    expect(json).not.toContain('owner-secret');
    expect(json).not.toContain('car-1');
    expect(json).not.toContain('e-old');
    expect(json).not.toContain('"shared"');
    expect(json).not.toContain('createdAt');
  });

  it('exports events newest-first', () => {
    const file = toCarExport(car, events, reminders, AT);
    expect(file.events.map((e) => e.date)).toEqual(['2024-02-01', '2023-06-01']);
  });

  it('preserves optional fields and defaults', () => {
    const file = toCarExport(car, events, reminders, AT);
    expect(file.car.nickname).toBe('Wolfie');
    expect(file.car.vin).toBe('WVWZZZ1KZAW000001');
    expect(file.events[1]!.works[0]!.parts[0]!.quantity).toBe(5);
  });
});
