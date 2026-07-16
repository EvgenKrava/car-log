import { CreateReminderSchema, CompleteReminderSchema } from '@carlog/contracts';
import {
  CarNotFoundError, ReminderNotFoundError, createReminder, completeReminder, bumpCarMileage,
  type CarRepository, type ReminderRepository,
} from '@carlog/domain';
import type { Car } from '@carlog/contracts';
import { ok, type ApiResult } from './errors';
import { assertReminderUnderCap } from './reminder-key';
import type { ApiEvent } from './router';

export type ReminderDeps = { cars: CarRepository; reminders: ReminderRepository };

// Handles /cars/{carId}/reminders* ; returns null if not matched.
export async function handleReminderRoute(
  deps: ReminderDeps, event: ApiEvent, ownerId: string, carId: string,
): Promise<ApiResult | null> {
  const { method, path, pathParams, body } = event;
  const base = `/cars/${carId}/reminders`;
  const reminderId = pathParams.reminderId;

  const car: Car | null = await deps.cars.getById(ownerId, carId);
  if (!car) throw new CarNotFoundError(carId);

  if (path === base && method === 'GET') {
    return ok(200, await deps.reminders.listByCar(ownerId, carId));
  }
  if (path === base && method === 'POST') {
    const existing = await deps.reminders.listByCar(ownerId, carId);
    assertReminderUnderCap(existing.length);
    const reminder = createReminder(ownerId, carId, CreateReminderSchema.parse(body));
    return ok(201, await deps.reminders.create(reminder));
  }
  if (reminderId && path === `${base}/${reminderId}/complete` && method === 'POST') {
    const completion = CompleteReminderSchema.parse(body);
    const reminder = await deps.reminders.getById(ownerId, carId, reminderId);
    if (!reminder) throw new ReminderNotFoundError(reminderId);
    const next = completeReminder(reminder, completion);
    if (next) await deps.reminders.create(next); // Put overwrites the same key
    else await deps.reminders.delete(ownerId, carId, reminderId);
    const bumped = bumpCarMileage(car, completion.mileage);
    if (bumped) await deps.cars.update(ownerId, carId, bumped);
    return next ? ok(200, next) : ok(204, null);
  }
  if (reminderId && path === `${base}/${reminderId}` && method === 'PUT') {
    const existing = await deps.reminders.getById(ownerId, carId, reminderId);
    if (!existing) throw new ReminderNotFoundError(reminderId);
    return ok(200, await deps.reminders.update(ownerId, carId, reminderId, CreateReminderSchema.parse(body)));
  }
  if (reminderId && path === `${base}/${reminderId}` && method === 'DELETE') {
    const existing = await deps.reminders.getById(ownerId, carId, reminderId);
    if (!existing) throw new ReminderNotFoundError(reminderId);
    await deps.reminders.delete(ownerId, carId, reminderId);
    return ok(204, null);
  }
  return null;
}
