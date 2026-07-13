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
});

describe('CarSchema', () => {
  it('requires id, ownerId and timestamps', () => {
    expect(() => CarSchema.parse({ make: 'x', model: 'y', year: 2020, mileage: 0, fuelType: 'petrol' })).toThrow();
  });
});
