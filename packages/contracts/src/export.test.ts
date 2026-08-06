import { describe, expect, it } from 'vitest';
import { CarExportSchema, CAR_EXPORT_FORMAT, CAR_EXPORT_VERSION } from './export';

const golden = {
  format: 'carlog-car',
  version: 1,
  exportedAt: '2026-08-06T10:00:00.000Z',
  attachments: 'not-included',
  car: { make: 'VW', model: 'Golf', year: 2018, mileage: 92000, fuelType: 'diesel' },
  events: [{
    date: '2024-02-01', mileage: 84000, cost: 3000, currency: 'UAH', category: 'brakes',
    works: [{ description: 'Front pads', parts: [{ name: 'Pads', quantity: 1 }] }],
  }],
  reminders: [{ title: 'Oil', category: 'oil_change', dueMileage: 100000 }],
};

describe('CarExportSchema', () => {
  it('accepts a golden export file', () => {
    const parsed = CarExportSchema.parse(golden);
    expect(parsed.format).toBe(CAR_EXPORT_FORMAT);
    expect(parsed.version).toBe(CAR_EXPORT_VERSION);
    expect(parsed.events[0]!.works[0]!.parts[0]!.name).toBe('Pads');
  });

  it('rejects an unknown version and a wrong format', () => {
    expect(() => CarExportSchema.parse({ ...golden, version: 2 })).toThrow();
    expect(() => CarExportSchema.parse({ ...golden, format: 'carlog-garage' })).toThrow();
  });

  it('strips unknown top-level fields (Zod default) — pinned', () => {
    const parsed = CarExportSchema.parse({ ...golden, hacked: true });
    expect('hacked' in parsed).toBe(false);
  });

  it('rejects over-cap collections', () => {
    const manyReminders = Array.from({ length: 21 }, (_, i) => ({
      title: `r${i}`, category: 'other', dueMileage: 1000 + i,
    }));
    expect(() => CarExportSchema.parse({ ...golden, reminders: manyReminders })).toThrow();
  });
});
