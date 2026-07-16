import { REMINDER_LEAD_DAYS, REMINDER_LEAD_KM, type Reminder } from '@carlog/contracts';

export type ReminderStatus = 'overdue' | 'due_soon' | 'ok';

export const todayISO = (): string => new Date().toISOString().slice(0, 10);

export const daysUntil = (today: string, dueDate: string): number =>
  Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

const addDaysISO = (dateISO: string, days: number): string => {
  const d = new Date(`${dateISO}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Mirrors packages/domain/src/reminder.ts reminderStatus — the domain package
// isn't browser-safe (node:crypto), so the classification is duplicated here.
// Keep the two implementations in sync.
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

const STATUS_RANK: Record<ReminderStatus, number> = { overdue: 0, due_soon: 1, ok: 2 };

// Urgency first; within a status, nearest due date, then smallest km remaining.
export function sortReminders(reminders: Reminder[], carMileage: number, today: string): Reminder[] {
  return [...reminders].sort((a, b) => {
    const rank = STATUS_RANK[reminderStatus(a, carMileage, today)] - STATUS_RANK[reminderStatus(b, carMileage, today)];
    if (rank !== 0) return rank;
    const byDate = (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31');
    if (byDate !== 0) return byDate;
    return (a.dueMileage ?? Infinity) - (b.dueMileage ?? Infinity);
  });
}