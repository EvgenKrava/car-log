import { describe, expect, it } from 'vitest';
import type { Car, Reminder } from '@carlog/contracts';
import { NOTIFY_STALE_DAYS, NOTIFY_RENOTIFY_DAYS, evaluateCarConditions, decideNotifications } from './notify';

const CAR_ID = '11111111-1111-4111-8111-111111111111';
const CAR_ID_2 = '22222222-2222-4222-8222-222222222222';

const car = (over: Partial<Car> = {}): Car => ({
  id: CAR_ID,
  ownerId: 'u1',
  make: 'VW',
  model: 'Golf',
  year: 2018,
  mileage: 50000,
  fuelType: 'diesel',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  mileageUpdatedAt: '2026-08-01T00:00:00.000Z',
  shared: false,
  ...over,
});

const reminder = (over: Partial<Reminder> = {}): Reminder => ({
  id: '33333333-3333-4333-8333-333333333333',
  carId: CAR_ID,
  ownerId: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  title: 'Oil change',
  category: 'oil_change',
  dueDate: '2026-08-01',
  ...over,
});

describe('evaluateCarConditions — staleness', () => {
  it('is NOT stale exactly at the boundary (day 7)', () => {
    const conditions = evaluateCarConditions(car({ mileageUpdatedAt: '2026-08-01T00:00:00.000Z' }), [], '2026-08-08');
    expect(conditions.find((c) => c.type === 'mileage')).toBeUndefined();
  });
  it('IS stale one day past the boundary (day 8)', () => {
    const conditions = evaluateCarConditions(car({ mileageUpdatedAt: '2026-08-01T00:00:00.000Z' }), [], '2026-08-09');
    expect(conditions).toEqual([{ carId: CAR_ID, type: 'mileage', daysStale: 8 }]);
  });
  it('a fresh car produces no condition', () => {
    const conditions = evaluateCarConditions(car({ mileageUpdatedAt: '2026-08-05T00:00:00.000Z' }), [], '2026-08-06');
    expect(conditions).toEqual([]);
  });
  it('NOTIFY_STALE_DAYS is 7', () => {
    expect(NOTIFY_STALE_DAYS).toBe(7);
  });
});

describe('evaluateCarConditions — reminders', () => {
  it('an overdue reminder produces a reminders condition with the correct nearest', () => {
    const conditions = evaluateCarConditions(
      car({ mileageUpdatedAt: '2026-08-01T00:00:00.000Z' }),
      [reminder({ dueDate: '2026-08-01' })],
      '2026-08-01',
    );
    expect(conditions).toEqual([
      { carId: CAR_ID, type: 'reminders', nearest: { title: 'Oil change', dueDate: '2026-08-01', dueMileage: undefined } },
    ]);
  });
  it('an "ok" reminder produces no condition', () => {
    const conditions = evaluateCarConditions(
      car({ mileageUpdatedAt: '2026-08-01T00:00:00.000Z' }),
      [reminder({ dueDate: '2027-01-01' })],
      '2026-08-01',
    );
    expect(conditions.find((c) => c.type === 'reminders')).toBeUndefined();
  });
  it('with several due reminders, nearest picks the closest dueDate first', () => {
    const conditions = evaluateCarConditions(
      car({ mileageUpdatedAt: '2026-08-01T00:00:00.000Z' }),
      [
        reminder({ id: 'a', title: 'Far', dueDate: '2026-08-01' }),
        reminder({ id: 'b', title: 'Near', dueDate: '2026-07-01' }),
      ],
      '2026-08-01',
    );
    expect(conditions[0]?.nearest?.title).toBe('Near');
  });
  it('when dueDate is absent, nearest picks the smallest dueMileage', () => {
    const conditions = evaluateCarConditions(
      car({ mileageUpdatedAt: '2026-08-01T00:00:00.000Z', mileage: 50000 }),
      [
        reminder({ id: 'a', title: 'Far', dueDate: undefined, dueMileage: 50900 }),
        reminder({ id: 'b', title: 'Near', dueDate: undefined, dueMileage: 50100 }),
      ],
      '2026-08-01',
    );
    expect(conditions[0]?.nearest?.title).toBe('Near');
  });
  it('both mileage staleness and a due reminder → two conditions', () => {
    const conditions = evaluateCarConditions(
      car({ mileageUpdatedAt: '2026-08-01T00:00:00.000Z' }),
      [reminder({ dueDate: '2026-08-09' })],
      '2026-08-09',
    );
    expect(conditions).toHaveLength(2);
    expect(conditions.map((c) => c.type).sort()).toEqual(['mileage', 'reminders']);
  });
});

describe('decideNotifications', () => {
  const cond = (carId = CAR_ID, type: 'mileage' | 'reminders' = 'mileage') => ({ carId, type } as const);

  it('sends on the first-ever evaluation of a condition', () => {
    const { send, nextLastNotified } = decideNotifications([cond()], {}, '2026-08-08');
    expect(send).toEqual([cond()]);
    expect(nextLastNotified).toEqual({ [`${CAR_ID}#mileage`]: '2026-08-08' });
  });

  it('a same-day re-run sends nothing', () => {
    const first = decideNotifications([cond()], {}, '2026-08-08');
    const second = decideNotifications([cond()], first.nextLastNotified, '2026-08-08');
    expect(second.send).toEqual([]);
    expect(second.nextLastNotified).toEqual(first.nextLastNotified);
  });

  it('day+3 while the condition persists sends nothing', () => {
    const first = decideNotifications([cond()], {}, '2026-08-08');
    const later = decideNotifications([cond()], first.nextLastNotified, '2026-08-11');
    expect(later.send).toEqual([]);
    expect(later.nextLastNotified).toEqual({ [`${CAR_ID}#mileage`]: '2026-08-08' });
  });

  it('day+7 re-sends', () => {
    const first = decideNotifications([cond()], {}, '2026-08-08');
    const later = decideNotifications([cond()], first.nextLastNotified, '2026-08-15');
    expect(later.send).toEqual([cond()]);
    expect(later.nextLastNotified).toEqual({ [`${CAR_ID}#mileage`]: '2026-08-15' });
  });

  it('NOTIFY_RENOTIFY_DAYS is 7', () => {
    expect(NOTIFY_RENOTIFY_DAYS).toBe(7);
  });

  it('a cleared condition for the same car prunes its key while a persisting sibling key survives', () => {
    const lastNotified = { [`${CAR_ID}#mileage`]: '2026-08-01', [`${CAR_ID}#reminders`]: '2026-08-01' };
    // only 'reminders' is still true today — 'mileage' cleared.
    const { nextLastNotified } = decideNotifications([cond(CAR_ID, 'reminders')], lastNotified, '2026-08-02');
    expect(nextLastNotified).toEqual({ [`${CAR_ID}#reminders`]: '2026-08-01' });
    expect(nextLastNotified[`${CAR_ID}#mileage`]).toBeUndefined();
  });

  it('keys belonging to a car not present in this call are preserved untouched', () => {
    const lastNotified = { [`${CAR_ID}#mileage`]: '2026-08-01', [`${CAR_ID_2}#reminders`]: '2026-07-01' };
    const { nextLastNotified } = decideNotifications([cond(CAR_ID, 'mileage')], lastNotified, '2026-08-08');
    expect(nextLastNotified[`${CAR_ID_2}#reminders`]).toBe('2026-07-01');
  });
});
