import { describe, expect, it } from 'vitest';
import type { Reminder } from '@carlog/contracts';
import { daysUntil, groupReminders, reminderStatus, sortReminders } from './reminder-view';

const r = (over: Partial<Reminder>): Reminder => ({
  id: crypto.randomUUID(), carId: crypto.randomUUID(), ownerId: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  title: 'x', category: 'other', ...over,
});

describe('daysUntil', () => {
  it('counts calendar days', () => {
    expect(daysUntil('2026-07-16', '2026-07-20')).toBe(4);
    expect(daysUntil('2026-07-16', '2026-07-16')).toBe(0);
    expect(daysUntil('2026-07-16', '2026-07-10')).toBe(-6);
  });
});

describe('reminderStatus (mirror of domain)', () => {
  it('classifies overdue / due_soon / ok', () => {
    expect(reminderStatus(r({ dueDate: '2026-07-16' }), 0, '2026-07-16')).toBe('overdue');
    expect(reminderStatus(r({ dueDate: '2026-08-10' }), 0, '2026-07-16')).toBe('due_soon');
    expect(reminderStatus(r({ dueDate: '2026-12-01' }), 0, '2026-07-16')).toBe('ok');
    expect(reminderStatus(r({ dueMileage: 50500 }), 50000, '2026-07-16')).toBe('due_soon');
  });
});

describe('sortReminders', () => {
  it('orders overdue → due_soon → ok, then by nearest date', () => {
    const ok = r({ dueDate: '2026-12-01', title: 'ok' });
    const soonLater = r({ dueDate: '2026-08-10', title: 'soonLater' });
    const soonNear = r({ dueDate: '2026-07-20', title: 'soonNear' });
    const over = r({ dueDate: '2026-07-01', title: 'over' });
    const sorted = sortReminders([ok, soonLater, soonNear, over], 0, '2026-07-16');
    expect(sorted.map((x) => x.title)).toEqual(['over', 'soonNear', 'soonLater', 'ok']);
  });
});

describe('groupReminders', () => {
  const r = (over: Partial<Reminder> & { id: string }): Reminder => ({
    carId: 'c1', ownerId: 'o1', title: over.id, category: 'other',
    notes: undefined, dueDate: undefined, dueMileage: undefined,
    repeatMonths: undefined, repeatKm: undefined,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
  const today = '2026-08-05';
  const mileage = 100_000;

  it('splits by status and keeps urgency order inside each group', () => {
    const groups = groupReminders([
      r({ id: 'later', dueDate: '2026-12-01' }),
      r({ id: 'overdue-km', dueMileage: 99_000 }),
      r({ id: 'soon', dueDate: '2026-08-20' }),          // inside 30-day lead
      r({ id: 'overdue-date', dueDate: '2026-08-01' }),
    ], mileage, today);
    expect(groups.overdue.map((x) => x.id)).toEqual(['overdue-date', 'overdue-km']);
    expect(groups.dueSoon.map((x) => x.id)).toEqual(['soon']);
    expect(groups.later.map((x) => x.id)).toEqual(['later']);
  });

  it('due today is overdue; exactly at the km lead threshold is due_soon', () => {
    const groups = groupReminders([
      r({ id: 'today', dueDate: today }),
      r({ id: 'at-lead', dueMileage: mileage + 1000 }), // REMINDER_LEAD_KM boundary
    ], mileage, today);
    expect(groups.overdue.map((x) => x.id)).toEqual(['today']);
    expect(groups.dueSoon.map((x) => x.id)).toEqual(['at-lead']);
  });

  it('returns three empty arrays for no reminders', () => {
    expect(groupReminders([], mileage, today)).toEqual({ overdue: [], dueSoon: [], later: [] });
  });
});
