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

export type AnchorSource = 'date' | 'km' | null;

// The Reminders card promotes ONE relative-dueness signal to a prominent anchor line.
// When only one target is set, that's the anchor. When both are set, show whichever
// target is driving today's status color (overdue beats due_soon beats ok); a tie
// (both targets land in the same status) prefers date.
export function anchorSource(
  reminder: Pick<Reminder, 'dueDate' | 'dueMileage'>, carMileage: number, today: string,
): AnchorSource {
  if (reminder.dueDate === undefined && reminder.dueMileage === undefined) return null;
  if (reminder.dueDate === undefined) return 'km';
  if (reminder.dueMileage === undefined) return 'date';
  const dateStatus = reminderStatus({ dueDate: reminder.dueDate, dueMileage: undefined }, carMileage, today);
  const kmStatus = reminderStatus({ dueDate: undefined, dueMileage: reminder.dueMileage }, carMileage, today);
  if (STATUS_RANK[dateStatus] === STATUS_RANK[kmStatus]) return 'date';
  return STATUS_RANK[dateStatus] < STATUS_RANK[kmStatus] ? 'date' : 'km';
}

export type ReminderGroups = { overdue: Reminder[]; dueSoon: Reminder[]; later: Reminder[] };

// The Reminders tab renders urgency sections; grouping reuses the sorted order so each
// section is internally sorted (nearest first) without a second comparator.
export function groupReminders(reminders: Reminder[], carMileage: number, today: string): ReminderGroups {
  const groups: ReminderGroups = { overdue: [], dueSoon: [], later: [] };
  for (const reminder of sortReminders(reminders, carMileage, today)) {
    const status = reminderStatus(reminder, carMileage, today);
    if (status === 'overdue') groups.overdue.push(reminder);
    else if (status === 'due_soon') groups.dueSoon.push(reminder);
    else groups.later.push(reminder);
  }
  return groups;
}
