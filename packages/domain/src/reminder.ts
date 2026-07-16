import {
  CreateReminderSchema, REMINDER_LEAD_DAYS, REMINDER_LEAD_KM,
  type CompleteReminderInput, type CreateReminderInput, type Reminder,
} from '@carlog/contracts';
import { newId as defaultNewId, nowIso } from './id';

export type CreateReminderDeps = { newId?: () => string; now?: () => string };

export function createReminder(
  ownerId: string, carId: string, input: CreateReminderInput, deps: CreateReminderDeps = {},
): Reminder {
  const data = CreateReminderSchema.parse(input);
  const timestamp = (deps.now ?? nowIso)();
  return { ...data, id: (deps.newId ?? defaultNewId)(), carId, ownerId, createdAt: timestamp, updatedAt: timestamp };
}

export type ReminderStatus = 'overdue' | 'due_soon' | 'ok';

const addDaysISO = (dateISO: string, days: number): string => {
  const d = new Date(`${dateISO}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Classification is read-time and pure; `today` is injected (YYYY-MM-DD) so tests
// and the API share one clock convention. Due ON the due date/mileage = overdue.
// NOTE: mirrored in apps/web/src/lib/reminder-view.ts (domain isn't browser-safe);
// keep the two in sync.
export function reminderStatus(
  reminder: Pick<Reminder, 'dueDate' | 'dueMileage'>, carMileage: number, today: string,
): ReminderStatus {
  const dateOverdue = reminder.dueDate !== undefined && today >= reminder.dueDate;
  const kmOverdue = reminder.dueMileage !== undefined && carMileage >= reminder.dueMileage;
  if (dateOverdue || kmOverdue) return 'overdue';
  const dateSoon = reminder.dueDate !== undefined && addDaysISO(today, REMINDER_LEAD_DAYS) >= reminder.dueDate;
  const kmSoon = reminder.dueMileage !== undefined && carMileage + REMINDER_LEAD_KM >= reminder.dueMileage;
  if (dateSoon || kmSoon) return 'due_soon';
  return 'ok';
}

// Calendar-month addition with month-end clamping (Jan 31 + 1mo → Feb 28).
export function addMonthsClamped(dateISO: string, months: number): string {
  const parts = dateISO.split('-').map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const d = parts[2]!;
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12; // 0-based month
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

export type CompleteReminderDeps = { now?: () => string };

// Next occurrence is anchored to the COMPLETION date/mileage, not the original due
// target — "every 6 months" means 6 months from when you actually did it.
// A target without its repeat interval is dropped from the next occurrence.
export function completeReminder(
  reminder: Reminder, completion: CompleteReminderInput, deps: CompleteReminderDeps = {},
): Reminder | null {
  const repeating = reminder.repeatMonths !== undefined || reminder.repeatKm !== undefined;
  if (!repeating) return null;
  return {
    ...reminder,
    dueDate: reminder.repeatMonths !== undefined ? addMonthsClamped(completion.date, reminder.repeatMonths) : undefined,
    dueMileage: reminder.repeatKm !== undefined ? completion.mileage + reminder.repeatKm : undefined,
    updatedAt: (deps.now ?? nowIso)(),
  };
}

export class ReminderNotFoundError extends Error {
  constructor(id: string) { super(`Reminder ${id} not found`); this.name = 'ReminderNotFoundError'; }
}