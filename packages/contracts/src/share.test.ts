import { describe, it, expect } from 'vitest';
import { SetSharingSchema, PublicCarSchema } from './share';

describe('share contracts', () => {
  it('validates SetSharing', () => {
    expect(SetSharingSchema.parse({ shared: true })).toEqual({ shared: true });
    expect(() => SetSharingSchema.parse({})).toThrow();
  });
  it('parses a public car (no owner fields)', () => {
    const pc = {
      id: '11111111-1111-1111-1111-111111111111', make: 'Mitsubishi', model: 'Galant',
      year: 2008, fuelType: 'petrol', mileage: 250000, vin: 'X', licensePlate: 'AX',
      events: [{ id: '22222222-2222-2222-2222-222222222222', date: '2026-01-01', category: 'oil_change', mileage: 250000, cost: 100, currency: 'UAH', works: [] }],
    };
    expect(PublicCarSchema.parse(pc)).toMatchObject({ make: 'Mitsubishi' });
    expect('ownerId' in PublicCarSchema.parse(pc)).toBe(false);
  });
});