import type { Reminder, CreateReminderInput } from '@carlog/contracts';
import { ReminderNotFoundError, type ReminderRepository } from '@carlog/domain';
import { reminderSk, isReminderRow } from './reminder-key';

export class InMemoryReminderRepository implements ReminderRepository {
  private rows = new Map<string, Reminder>();
  private k(ownerId: string, sk: string) { return `${ownerId}|${sk}`; }

  async create(reminder: Reminder): Promise<Reminder> {
    this.rows.set(this.k(reminder.ownerId, reminderSk(reminder.carId, reminder.id)), reminder);
    return reminder;
  }
  async listByCar(ownerId: string, carId: string): Promise<Reminder[]> {
    const prefix = `CAR#${carId}#REMINDER#`;
    return [...this.rows.entries()]
      .filter(([key]) => key.startsWith(`${ownerId}|`))
      .map(([key, r]) => [key.slice(ownerId.length + 1), r] as const)
      .filter(([sk]) => sk.startsWith(prefix) && isReminderRow(sk))
      .map(([, r]) => r);
  }
  async getById(ownerId: string, carId: string, reminderId: string): Promise<Reminder | null> {
    return this.rows.get(this.k(ownerId, reminderSk(carId, reminderId))) ?? null;
  }
  async update(ownerId: string, carId: string, reminderId: string, input: CreateReminderInput): Promise<Reminder> {
    const existing = this.rows.get(this.k(ownerId, reminderSk(carId, reminderId)));
    if (!existing) throw new ReminderNotFoundError(reminderId);
    const updated: Reminder = { ...input, id: existing.id, carId, ownerId, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    this.rows.set(this.k(ownerId, reminderSk(carId, reminderId)), updated);
    return updated;
  }
  async delete(ownerId: string, carId: string, reminderId: string): Promise<void> {
    this.rows.delete(this.k(ownerId, reminderSk(carId, reminderId)));
  }
}
