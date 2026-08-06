import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Car } from '@carlog/contracts';
import { InMemoryCarRepository } from './in-memory-car-repository';
import { InMemoryEventRepository } from './in-memory-event-repository';
import { InMemoryReminderRepository } from './in-memory-reminder-repository';
import { handleImportCarRoute, type ImportCarDeps } from './import-car-route';
import type { ApiEvent } from './router';

const OWNER = 'owner-1';

const file = {
  format: 'carlog-car', version: 1, exportedAt: '2026-08-06T10:00:00.000Z',
  attachments: 'not-included',
  car: { make: 'VW', model: 'Golf', year: 2018, mileage: 92000, fuelType: 'diesel' },
  events: [
    { date: '2024-02-01', mileage: 84000, cost: 3000, currency: 'UAH', category: 'brakes', works: [] },
    { date: '2023-06-01', mileage: 70000, cost: 1200, currency: 'UAH', category: 'oil_change', works: [] },
  ],
  reminders: [{ title: 'Oil', category: 'oil_change', dueMileage: 100000 }],
};

const post = (body: unknown): ApiEvent => ({
  method: 'POST', path: '/import/car', ownerId: OWNER, groups: [],
  pathParams: {}, queryParams: {}, body,
});

describe('POST /import/car', () => {
  let deps: ImportCarDeps;
  beforeEach(() => {
    deps = {
      cars: new InMemoryCarRepository(),
      events: new InMemoryEventRepository(),
      reminders: new InMemoryReminderRepository(),
    };
  });

  it('creates the car with all events and reminders', async () => {
    const res = await handleImportCarRoute(deps, post(file), OWNER);
    expect(res?.statusCode).toBe(201);
    const car = JSON.parse(res!.body) as Car;
    expect(car.make).toBe('VW');
    expect(car.mileage).toBe(92000); // from the file, not derived
    expect(car.ownerId).toBe(OWNER);
    expect(car.shared).toBe(false);
    expect(await deps.events.listByCar(OWNER, car.id)).toHaveLength(2);
    expect(await deps.reminders.listByCar(OWNER, car.id)).toHaveLength(1);
  });

  // CarExportSchema.parse throws a ZodError that this route does NOT catch — it propagates
  // to withErrorHandling (in router.ts), which maps it to 400. Called directly here (no
  // withErrorHandling wrapper), so the observable behavior is a rejected promise.
  it('rejects a wrong version by throwing (mapped to 400 by withErrorHandling) and creates nothing', async () => {
    await expect(handleImportCarRoute(deps, post({ ...file, version: 2 }), OWNER)).rejects.toThrow();
    expect(await deps.cars.listByOwner(OWNER)).toHaveLength(0);
  });

  // The route generates each event/reminder's id itself (via createEvent/createReminder)
  // before calling the repo, and tracks that generated id for cleanup — it never depends
  // on the repo's `create` return value. The spy here calls through to the real repo for
  // every event but the last, so the first event genuinely lands as a row — cleanup has
  // something real to delete, and the assertions below can actually catch a broken loop.
  it('cleans up everything when an event write fails mid-import', async () => {
    const carsCreateSpy = vi.spyOn(deps.cars, 'create');
    const originalCreate = deps.events.create.bind(deps.events);
    let calls = 0;
    const failing = vi.spyOn(deps.events, 'create').mockImplementation(async (e) => {
      calls += 1;
      if (calls === file.events.length) throw new Error('dynamo down'); // fail on the last event
      return originalCreate(e);
    });
    await expect(handleImportCarRoute(deps, post(file), OWNER)).rejects.toThrow('dynamo down');
    const createdCar = (await carsCreateSpy.mock.results[0]!.value) as Car;
    expect(await deps.cars.listByOwner(OWNER)).toHaveLength(0); // no half-imported car
    expect(await deps.events.listByCar(OWNER, createdCar.id)).toHaveLength(0); // no orphan events
    expect(await deps.reminders.listByCar(OWNER, createdCar.id)).toHaveLength(0); // no orphan reminders
    failing.mockRestore();
  });

  it('cleans up when a reminder write fails after all events succeeded', async () => {
    const carsCreateSpy = vi.spyOn(deps.cars, 'create');
    vi.spyOn(deps.reminders, 'create').mockRejectedValueOnce(new Error('boom'));
    await expect(handleImportCarRoute(deps, post(file), OWNER)).rejects.toThrow('boom');
    const createdCar = (await carsCreateSpy.mock.results[0]!.value) as Car;
    expect(await deps.cars.listByOwner(OWNER)).toHaveLength(0);
    expect(await deps.events.listByCar(OWNER, createdCar.id)).toHaveLength(0); // events created before the reminder failure are also gone
    expect(await deps.reminders.listByCar(OWNER, createdCar.id)).toHaveLength(0);
  });

  it('returns null for non-matching paths', async () => {
    const res = await handleImportCarRoute(deps, { ...post(file), path: '/import/jobs' }, OWNER);
    expect(res).toBeNull();
  });

  it('returns null for a non-POST method on the matching path', async () => {
    const res = await handleImportCarRoute(deps, { ...post(file), method: 'PUT' }, OWNER);
    expect(res).toBeNull();
  });
});
