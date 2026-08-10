import type { Car, Reminder } from '@carlog/contracts';
import { reminderStatus } from './reminder';

export const NOTIFY_STALE_DAYS = 7;
export const NOTIFY_RENOTIFY_DAYS = 7;

export type NotifyCondition = {
  carId: string;
  type: 'mileage' | 'reminders';
  daysStale?: number; // mileage type
  nearest?: { title: string; dueDate?: string; dueMileage?: number }; // reminders type
};

// Whole-day difference, UTC-anchored (mirrors packages/domain/src/reminder.ts). Only the
// date part of either input is used, so a full ISO datetime (e.g. mileageUpdatedAt) works
// the same as a plain YYYY-MM-DD (e.g. a lastNotified entry).
const daysBetween = (fromISO: string, toISO: string): number => {
  const from = Date.parse(`${fromISO.slice(0, 10)}T00:00:00.000Z`);
  const to = Date.parse(`${toISO.slice(0, 10)}T00:00:00.000Z`);
  return Math.floor((to - from) / 86_400_000);
};

// Nearest dueDate first (missing sorts last), then smallest dueMileage (missing sorts
// last) — same convention as apps/web/src/lib/reminder-view.ts sortReminders.
const pickNearest = (reminders: Reminder[]): Reminder =>
  [...reminders].sort((a, b) => {
    const byDate = (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31');
    if (byDate !== 0) return byDate;
    return (a.dueMileage ?? Infinity) - (b.dueMileage ?? Infinity);
  })[0]!;

// What's wrong with this car today? Pure: no I/O, no clock (today is injected), no crypto.
export function evaluateCarConditions(car: Car, reminders: Reminder[], today: string): NotifyCondition[] {
  const conditions: NotifyCondition[] = [];

  const daysStale = daysBetween(car.mileageUpdatedAt, today);
  if (daysStale > NOTIFY_STALE_DAYS) {
    conditions.push({ carId: car.id, type: 'mileage', daysStale });
  }

  const due = reminders.filter((r) => {
    const status = reminderStatus(r, car.mileage, today);
    return status === 'overdue' || status === 'due_soon';
  });
  if (due.length > 0) {
    const nearest = pickNearest(due);
    conditions.push({
      carId: car.id,
      type: 'reminders',
      nearest: { title: nearest.title, dueDate: nearest.dueDate, dueMileage: nearest.dueMileage },
    });
  }

  return conditions;
}

// Which conditions actually fire today, given what we already sent?
//
// - at most one send per `<carId>#<type>` per calendar day
// - while a condition persists, re-send only every NOTIFY_RENOTIFY_DAYS
// - keys whose condition CLEARED are PRUNED from `nextLastNotified`
//
// "Cleared" is scoped to cars this call actually evaluated: a key is dropped only when
// its carId appears somewhere in `conditions` (so we know that car was evaluated this
// run) but the specific `<carId>#<type>` key isn't among them (so that particular
// condition is no longer true). A key whose carId doesn't appear in `conditions` at all
// is left untouched — callers only pass conditions for the cars in scope for this call
// (e.g. a subscription row's evaluated cars), and a key outside that scope (e.g. a
// deleted car) is not evidence of anything clearing.
export function decideNotifications(
  conditions: NotifyCondition[],
  lastNotified: Record<string, string>,
  today: string,
): { send: NotifyCondition[]; nextLastNotified: Record<string, string> } {
  const send: NotifyCondition[] = [];
  const nextLastNotified: Record<string, string> = { ...lastNotified };
  const scopedCarIds = new Set(conditions.map((c) => c.carId));
  const activeKeys = new Set(conditions.map((c) => `${c.carId}#${c.type}`));

  for (const key of Object.keys(nextLastNotified)) {
    const carId = key.split('#')[0]!;
    if (scopedCarIds.has(carId) && !activeKeys.has(key)) delete nextLastNotified[key];
  }

  for (const cond of conditions) {
    const key = `${cond.carId}#${cond.type}`;
    const last = lastNotified[key];
    if (last === undefined || daysBetween(last, today) >= NOTIFY_RENOTIFY_DAYS) {
      send.push(cond);
      nextLastNotified[key] = today;
    }
    // else: persisting, not due for re-notify — nextLastNotified already carries the
    // previous value forward via the initial spread copy.
  }

  return { send, nextLastNotified };
}
