import { describe, expect, it } from 'vitest';
import { CreateReminderSchema, CompleteReminderSchema } from './reminder';

const base = { title: 'Oil change', category: 'oil_change' };

describe('CreateReminderSchema', () => {
  it('accepts a date-only reminder', () => {
    const r = CreateReminderSchema.parse({ ...base, dueDate: '2026-09-01' });
    expect(r.dueDate).toBe('2026-09-01');
    expect(r.dueMileage).toBeUndefined();
  });

  it('accepts a mileage-only reminder with repeat', () => {
    const r = CreateReminderSchema.parse({ ...base, dueMileage: 120000, repeatKm: 10000 });
    expect(r.repeatKm).toBe(10000);
  });

  it('rejects when neither dueDate nor dueMileage is set', () => {
    expect(() => CreateReminderSchema.parse(base)).toThrow();
  });

  it('rejects repeatMonths without dueDate', () => {
    expect(() => CreateReminderSchema.parse({ ...base, dueMileage: 120000, repeatMonths: 12 })).toThrow();
  });

  it('rejects repeatKm without dueMileage', () => {
    expect(() => CreateReminderSchema.parse({ ...base, dueDate: '2026-09-01', repeatKm: 10000 })).toThrow();
  });

  it('normalizes empty notes to undefined', () => {
    const r = CreateReminderSchema.parse({ ...base, dueDate: '2026-09-01', notes: '' });
    expect(r.notes).toBeUndefined();
  });

  it('rejects a malformed dueDate', () => {
    expect(() => CreateReminderSchema.parse({ ...base, dueDate: '01-09-2026' })).toThrow();
  });
});

describe('CompleteReminderSchema', () => {
  it('accepts a valid completion', () => {
    expect(CompleteReminderSchema.parse({ date: '2026-07-16', mileage: 95000 })).toEqual({ date: '2026-07-16', mileage: 95000 });
  });
  it('rejects negative mileage', () => {
    expect(() => CompleteReminderSchema.parse({ date: '2026-07-16', mileage: -1 })).toThrow();
  });
});
