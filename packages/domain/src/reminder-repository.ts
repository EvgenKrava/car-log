import type { Reminder, CreateReminderInput } from '@carlog/contracts';

export interface ReminderRepository {
  create(reminder: Reminder): Promise<Reminder>;
  listByCar(ownerId: string, carId: string): Promise<Reminder[]>;
  getById(ownerId: string, carId: string, reminderId: string): Promise<Reminder | null>;
  update(ownerId: string, carId: string, reminderId: string, input: CreateReminderInput): Promise<Reminder>;
  delete(ownerId: string, carId: string, reminderId: string): Promise<void>;
}