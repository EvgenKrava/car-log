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
