import { MAX_REMINDERS_PER_CAR } from '@carlog/contracts';
import { CapExceededError } from '@carlog/domain';

export const reminderSk = (carId: string, reminderId: string): string => `CAR#${carId}#REMINDER#${reminderId}`;

export const isReminderRow = (sk: string): boolean => sk.includes('#REMINDER#');

export function assertReminderUnderCap(count: number): void {
  if (count >= MAX_REMINDERS_PER_CAR) throw new CapExceededError();
}