import { describe, expect, it } from 'vitest';
import { assertReminderUnderCap, isReminderRow, reminderSk } from './reminder-key';

describe('reminder keys', () => {
  it('builds the reminder SK', () => {
    expect(reminderSk('c1', 'r1')).toBe('CAR#c1#REMINDER#r1');
  });
  it('identifies reminder rows and rejects others', () => {
    expect(isReminderRow('CAR#c1#REMINDER#r1')).toBe(true);
    expect(isReminderRow('CAR#c1#EVENT#e1')).toBe(false);
    expect(isReminderRow('CAR#c1')).toBe(false);
  });
  it('throws CapExceededError at the cap', () => {
    expect(() => assertReminderUnderCap(20)).toThrow('limit');
    expect(() => assertReminderUnderCap(19)).not.toThrow();
  });
});