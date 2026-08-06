import { CarExportSchema } from '@carlog/contracts';
import {
  createCar, createEvent, createReminder,
  type CarRepository, type EventRepository, type ReminderRepository,
} from '@carlog/domain';
import { ok, type ApiResult } from './errors';
import type { ApiEvent } from './router';

export type ImportCarDeps = {
  cars: CarRepository;
  events: EventRepository;
  reminders: ReminderRepository;
};

// POST /import/car — recreate a car from a CarLog export file as a NEW car.
// Handles only that path; returns null otherwise.
//
// Creation order: car → events → reminders, all server-side (no per-item HTTP). If any
// write fails, everything created so far is deleted (reminders, events, then the car) and
// the error rethrown — a half-imported car must never remain in the garage, and a retry
// of the whole import is then safe. Car mileage comes from the file verbatim.
//
// Cleanup tracks the ids this route GENERATED (from createEvent/createReminder), not the
// repository's create() return value — so cleanup is correct even if a repo's create()
// resolves with something unexpected before failing on a later call.
export async function handleImportCarRoute(
  deps: ImportCarDeps, event: ApiEvent, ownerId: string,
): Promise<ApiResult | null> {
  if (event.path !== '/import/car' || event.method !== 'POST') return null;

  const file = CarExportSchema.parse(event.body); // ZodError → 400 via withErrorHandling

  const car = await deps.cars.create(createCar(ownerId, file.car));
  const createdEventIds: string[] = [];
  const createdReminderIds: string[] = [];
  try {
    for (const input of file.events) {
      const generated = createEvent(ownerId, car.id, input);
      createdEventIds.push(generated.id);
      await deps.events.create(generated);
    }
    for (const input of file.reminders) {
      const generated = createReminder(ownerId, car.id, input);
      createdReminderIds.push(generated.id);
      await deps.reminders.create(generated);
    }
  } catch (err) {
    // Best-effort cleanup, most-recent phase first. Deletes are idempotent; if one throws
    // we still attempt the rest, and the car delete last (its absence is what hides any
    // stragglers from every list view, which queries by car). This is NOT atomic: if the
    // process dies mid-cleanup, the car row can briefly survive with partial/no children.
    // A retry is still safe — import always mints a brand-new car id, so it can't collide
    // with or complete the stranded one; the stranded row just needs a separate manual or
    // admin-feed-driven cleanup. True atomicity would need a DynamoDB transaction across
    // all writes, which is deliberately out of scope here.
    for (const id of createdReminderIds) {
      await deps.reminders.delete(ownerId, car.id, id).catch(() => undefined);
    }
    for (const id of createdEventIds) {
      await deps.events.delete(ownerId, car.id, id).catch(() => undefined);
    }
    await deps.cars.delete(ownerId, car.id).catch(() => undefined);
    throw err;
  }

  return ok(201, car);
}
