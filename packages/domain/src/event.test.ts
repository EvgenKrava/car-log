import { describe, expect, it } from 'vitest';
import { createEvent } from './event';

const deps = { newId: () => 'evt-id', now: () => '2026-07-14T00:00:00.000Z' };
const input = { date: '2026-07-14', mileage: 1000, cost: 500, currency: 'UAH', category: 'repair' as const, works: [] };

describe('createEvent', () => {
  it('assigns id/carId/ownerId/timestamps and defaults', () => {
    const e = createEvent('u1', '11111111-1111-1111-1111-111111111111', input, deps);
    expect(e).toMatchObject({ id: 'evt-id', ownerId: 'u1', carId: '11111111-1111-1111-1111-111111111111', category: 'repair', currency: 'UAH' });
    expect(e.works).toEqual([]);
    expect(e.createdAt).toBe('2026-07-14T00:00:00.000Z');
  });
  it('rejects invalid input', () => {
    expect(() => createEvent('u1', '11111111-1111-1111-1111-111111111111', { ...input, mileage: -5 }, deps)).toThrow();
  });
});
