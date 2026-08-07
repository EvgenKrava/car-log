import { describe, expect, it } from 'vitest';
import { CreateCarSchema, CarSchema } from './car';

describe('CreateCarSchema', () => {
  const valid = { make: 'Toyota', model: 'Corolla', year: 2020, mileage: 45000, fuelType: 'petrol' };

  it('accepts a valid car', () => {
    expect(CreateCarSchema.parse(valid)).toMatchObject(valid);
  });

  it('rejects a year before 1900', () => {
    expect(() => CreateCarSchema.parse({ ...valid, year: 1899 })).toThrow();
  });

  it('rejects negative mileage', () => {
    expect(() => CreateCarSchema.parse({ ...valid, mileage: -1 })).toThrow();
  });

  it('rejects an unknown fuelType', () => {
    expect(() => CreateCarSchema.parse({ ...valid, fuelType: 'coal' })).toThrow();
  });

  it('normalizes empty optional strings to undefined', () => {
    const parsed = CreateCarSchema.parse({ ...valid, vin: '', nickname: '' });
    expect(parsed.vin).toBeUndefined();
    expect(parsed.nickname).toBeUndefined();
  });

  it('accepts an engine volume in liters', () => {
    expect(CreateCarSchema.parse({ ...valid, engineVolume: 2 }).engineVolume).toBe(2);
    expect(CreateCarSchema.parse({ ...valid, engineVolume: 1.6 }).engineVolume).toBe(1.6);
    expect(CreateCarSchema.parse(valid).engineVolume).toBeUndefined();
  });

  it('rejects out-of-range engine volume', () => {
    expect(() => CreateCarSchema.parse({ ...valid, engineVolume: 0 })).toThrow();
    expect(() => CreateCarSchema.parse({ ...valid, engineVolume: -1.6 })).toThrow();
    expect(() => CreateCarSchema.parse({ ...valid, engineVolume: 30 })).toThrow();
  });
});

describe('CarSchema', () => {
  it('requires id, ownerId and timestamps', () => {
    expect(() => CarSchema.parse({ make: 'x', model: 'y', year: 2020, mileage: 0, fuelType: 'petrol' })).toThrow();
  });
});

describe('CarSchema mileageUpdatedAt', () => {
  const base = {
    id: '11111111-1111-4111-8111-111111111111', ownerId: 'o', make: 'VW', model: 'Golf',
    year: 2018, mileage: 1000, fuelType: 'diesel',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  it('is required on Car', () => {
    expect(() => CarSchema.parse(base)).toThrow();
    expect(CarSchema.parse({ ...base, mileageUpdatedAt: '2026-01-01T00:00:00.000Z' }).mileageUpdatedAt)
      .toBe('2026-01-01T00:00:00.000Z');
  });
  it('is NOT accepted on CreateCarSchema (server-owned)', () => {
    const parsed = CreateCarSchema.parse({ make: 'VW', model: 'Golf', year: 2018, mileage: 1, fuelType: 'diesel', mileageUpdatedAt: 'x' });
    expect('mileageUpdatedAt' in parsed).toBe(false); // stripped
  });
});
