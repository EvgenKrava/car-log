import { describe, expect, it } from 'vitest';
import { CreateEventSchema, WorkSchema } from './event';

const validEvent = {
  date: '2026-07-14', mileage: 120000, cost: 1500, currency: 'UAH', category: 'oil_change',
  works: [{ description: 'Oil & filter change', parts: [{ name: 'Oil filter', quantity: 1 }] }],
};

describe('CreateEventSchema', () => {
  it('accepts a valid nested event', () => {
    expect(CreateEventSchema.parse(validEvent)).toMatchObject({ category: 'oil_change' });
  });
  it('rejects an unknown category', () => {
    expect(() => CreateEventSchema.parse({ ...validEvent, category: 'spaceship' })).toThrow();
  });
  it('rejects negative mileage', () => {
    expect(() => CreateEventSchema.parse({ ...validEvent, mileage: -1 })).toThrow();
  });
  it('rejects a part with quantity < 1', () => {
    expect(() => CreateEventSchema.parse({ ...validEvent, works: [{ description: 'x', parts: [{ name: 'p', quantity: 0 }] }] })).toThrow();
  });
  it('rejects a part with a bad purchaseLink url', () => {
    expect(() => CreateEventSchema.parse({ ...validEvent, works: [{ description: 'x', parts: [{ name: 'p', quantity: 1, purchaseLink: 'not-a-url' }] }] })).toThrow();
  });
  it('normalizes empty-string optional part fields to undefined (empty purchaseLink is OK)', () => {
    const parsed = CreateEventSchema.parse({ ...validEvent, works: [{ description: 'x', parts: [{ name: 'p', quantity: 1, brand: '', partNumber: '', notes: '', purchaseLink: '' }] }] });
    const part = parsed.works[0].parts[0];
    expect(part.purchaseLink).toBeUndefined();
    expect(part.brand).toBeUndefined();
  });
  it('defaults works and currency', () => {
    const e = CreateEventSchema.parse({ date: '2026-07-14', mileage: 0, cost: 0, category: 'other' });
    expect(e.works).toEqual([]);
    expect(e.currency).toBe('UAH');
  });
});

describe('WorkSchema', () => {
  it('defaults parts to []', () => {
    expect(WorkSchema.parse({ description: 'Rotate tires' }).parts).toEqual([]);
  });
});
