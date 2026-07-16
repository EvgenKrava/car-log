import { describe, expect, it } from 'vitest';
import type { Reminder } from '@carlog/contracts';
import { addMonthsClamped, completeReminder, createReminder, reminderStatus } from './reminder';

const reminder = (over: Partial<Reminder> = {}): Reminder => ({
  id: '11111111-1111-4111-8111-111111111111',
  carId: '22222222-2222-4222-8222-222222222222',
  ownerId: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  title: 'Oil change',
  category: 'oil_change',
  dueDate: '2026-09-01',
  ...over,
});

describe('createReminder', () => {
  it('stamps id, ownership and timestamps', () => {
    const r = createReminder('u1', reminder().carId, { title: 'Oil', category: 'oil_change', dueDate: '2026-09-01' },
      { newId: () => reminder().id, now: () => '2026-07-16T00:00:00.000Z' });
    expect(r).toMatchObject({ id: reminder().id, ownerId: 'u1', carId: reminder().carId, createdAt: '2026-07-16T00:00:00.000Z' });
  });
});

describe('reminderStatus', () => {
  it('is ok well before the due date', () => {
    expect(reminderStatus(reminder(), 50000, '2026-07-16')).toBe('ok');
  });
  it('is due_soon exactly at the lead-window edge (30 days)', () => {
    expect(reminderStatus(reminder({ dueDate: '2026-08-15' }), 50000, '2026-07-16')).toBe('due_soon');
  });
  it('is overdue on the due date itself', () => {
    expect(reminderStatus(reminder({ dueDate: '2026-07-16' }), 50000, '2026-07-16')).toBe('overdue');
  });
  it('is due_soon within 1000 km of due mileage', () => {
    expect(reminderStatus(reminder({ dueDate: undefined, dueMileage: 50900 }), 50000, '2026-07-16')).toBe('due_soon');
  });
  it('is overdue at exactly the due mileage', () => {
    expect(reminderStatus(reminder({ dueDate: undefined, dueMileage: 50000 }), 50000, '2026-07-16')).toBe('overdue');
  });
  it('with both targets, the more urgent one wins', () => {
    // date far away, mileage already passed
    expect(reminderStatus(reminder({ dueDate: '2027-01-01', dueMileage: 49000 }), 50000, '2026-07-16')).toBe('overdue');
  });
});

describe('addMonthsClamped', () => {
  it('adds calendar months', () => {
    expect(addMonthsClamped('2026-07-16', 12)).toBe('2027-07-16');
  });
  it('clamps month-end (Jan 31 + 1 month = Feb 28)', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
  });
  it('handles year rollover', () => {
    expect(addMonthsClamped('2026-11-30', 3)).toBe('2027-02-28');
  });
});

describe('completeReminder', () => {
  it('returns null for a one-shot reminder', () => {
    expect(completeReminder(reminder(), { date: '2026-07-16', mileage: 51000 })).toBeNull();
  });
  it('advances dueDate from the completion date by repeatMonths', () => {
    const next = completeReminder(reminder({ repeatMonths: 6 }), { date: '2026-07-20', mileage: 51000 },
      { now: () => '2026-07-20T10:00:00.000Z' });
    expect(next).toMatchObject({ dueDate: '2027-01-20', updatedAt: '2026-07-20T10:00:00.000Z' });
    expect(next?.dueMileage).toBeUndefined();
  });
  it('advances dueMileage from the completion mileage by repeatKm', () => {
    const next = completeReminder(reminder({ dueDate: undefined, dueMileage: 50000, repeatKm: 10000 }),
      { date: '2026-07-20', mileage: 51234 });
    expect(next?.dueMileage).toBe(61234);
    expect(next?.dueDate).toBeUndefined();
  });
  it('drops a target that has no repeat interval', () => {
    // dueDate had no repeatMonths → next occurrence is mileage-only
    const next = completeReminder(reminder({ dueDate: '2026-09-01', dueMileage: 50000, repeatKm: 10000 }),
      { date: '2026-07-20', mileage: 51000 });
    expect(next?.dueDate).toBeUndefined();
    expect(next?.dueMileage).toBe(61000);
  });
  it('keeps the same id', () => {
    const next = completeReminder(reminder({ repeatMonths: 6 }), { date: '2026-07-20', mileage: 0 });
    expect(next?.id).toBe(reminder().id);
  });
});