import { describe, expect, it, beforeEach } from 'vitest';
import type { Car, Event, Reminder } from '@carlog/contracts';
import { InMemoryCarRepository } from './in-memory-car-repository';
import { InMemoryEventRepository } from './in-memory-event-repository';
import { InMemoryReminderRepository } from './in-memory-reminder-repository';
import { DomainChatToolExecutor } from './chat-tool-executor';

const OWNER = 'owner-1';
const CAR_ID = '33333333-3333-4333-8333-333333333333';

const car: Car = {
  id: CAR_ID, ownerId: OWNER, make: 'VW', model: 'Golf', year: 2018, mileage: 90000,
  fuelType: 'diesel', engineVolume: 2, nickname: 'Wolfie', vin: undefined, licensePlate: undefined,
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', shared: false,
};

let ids = 0;
const newId = () => `00000000-0000-4000-8000-${String(ids++).padStart(12, '0')}`;

describe('DomainChatToolExecutor', () => {
  let cars: InMemoryCarRepository;
  let events: InMemoryEventRepository;
  let reminders: InMemoryReminderRepository;

  const build = (timeline: Event[] = []) => new DomainChatToolExecutor({
    cars, events, reminders, car, timeline, ownerId: OWNER, carId: CAR_ID, newId,
  });

  beforeEach(async () => {
    ids = 0;
    cars = new InMemoryCarRepository();
    events = new InMemoryEventRepository();
    reminders = new InMemoryReminderRepository();
    await cars.create(car);
  });

  it('creates a reminder and reports a done action', async () => {
    const out = await build().execute({
      id: 't1', name: 'create_reminder',
      input: { title: 'Oil change', category: 'oil_change', dueMileage: 100000 },
    });
    expect(out.isError).toBe(false);
    expect(out.action?.kind).toBe('create_reminder');
    expect(out.action?.status).toBe('done');
    expect(out.action?.summary).toContain('Oil change');
    const stored = await reminders.listByCar(OWNER, CAR_ID);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.dueMileage).toBe(100000);
  });

  it('rejects an invalid reminder without writing', async () => {
    const out = await build().execute({
      id: 't1', name: 'create_reminder',
      input: { title: 'No target', category: 'other' }, // neither dueDate nor dueMileage
    });
    expect(out.isError).toBe(true);
    expect(out.content.toLowerCase()).toContain('due');
    expect(out.action).toBeUndefined();
    expect(await reminders.listByCar(OWNER, CAR_ID)).toEqual([]);
  });

  it('enforces the per-car reminder cap', async () => {
    for (let i = 0; i < 20; i += 1) {
      await build().execute({
        id: 't', name: 'create_reminder',
        input: { title: `r${i}`, category: 'other', dueMileage: 100000 + i },
      });
    }
    const out = await build().execute({
      id: 't', name: 'create_reminder',
      input: { title: 'one too many', category: 'other', dueMileage: 200000 },
    });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('20');
    expect(await reminders.listByCar(OWNER, CAR_ID)).toHaveLength(20);
  });

  it('merges only the given fields when updating a reminder', async () => {
    const created = await build().execute({
      id: 't1', name: 'create_reminder',
      input: { title: 'Oil', category: 'oil_change', dueMileage: 100000, notes: 'keep me' },
    });
    const rid = created.action!.entityId!;
    const out = await build().execute({
      id: 't2', name: 'update_reminder', input: { id: rid, dueMileage: 110000 },
    });
    expect(out.isError).toBe(false);
    const stored = await reminders.getById(OWNER, CAR_ID, rid);
    expect(stored!.dueMileage).toBe(110000);
    expect(stored!.title).toBe('Oil');        // preserved
    expect(stored!.notes).toBe('keep me');    // preserved
  });

  it('reports not-found for an unknown reminder id', async () => {
    const out = await build().execute({
      id: 't1', name: 'update_reminder',
      input: { id: '99999999-9999-4999-8999-999999999999', dueMileage: 1 },
    });
    expect(out.isError).toBe(true);
    expect(out.content.toLowerCase()).toContain('no reminder');
  });

  it('proposes a reminder delete without deleting', async () => {
    const created = await build().execute({
      id: 't1', name: 'create_reminder',
      input: { title: 'Doomed', category: 'other', dueMileage: 100000 },
    });
    const rid = created.action!.entityId!;
    const out = await build().execute({ id: 't2', name: 'delete_reminder', input: { id: rid } });
    expect(out.isError).toBe(false);
    expect(out.action?.status).toBe('pending');
    expect(out.action?.pending).toEqual({ target: 'reminder', entityId: rid });
    expect(await reminders.getById(OWNER, CAR_ID, rid)).not.toBeNull(); // still there
  });

  it('creates an event and bumps the car odometer', async () => {
    const out = await build().execute({
      id: 't1', name: 'create_event',
      input: { date: '2026-08-04', mileage: 95000, category: 'oil_change', cost: 1800, title: 'Oil' },
    });
    expect(out.isError).toBe(false);
    expect(out.action?.kind).toBe('create_event');
    expect((await events.listByCar(OWNER, CAR_ID))).toHaveLength(1);
    expect((await cars.getById(OWNER, CAR_ID))!.mileage).toBe(95000);
  });

  it('does not lower the odometer for an older event', async () => {
    const created = await build().execute({
      id: 't1', name: 'create_event',
      input: { date: '2020-01-01', mileage: 10000, category: 'other', cost: 0 },
    });
    expect(created.isError).toBe(false); // guard against a vacuous pass if creation itself failed
    expect((await cars.getById(OWNER, CAR_ID))!.mileage).toBe(90000); // unchanged
  });

  it('proposes an event delete without deleting', async () => {
    const created = await build().execute({
      id: 't1', name: 'create_event',
      input: { date: '2026-08-04', mileage: 95000, category: 'other', cost: 0 },
    });
    const eid = created.action!.entityId!;
    const out = await build().execute({ id: 't2', name: 'delete_event', input: { id: eid } });
    expect(out.action?.status).toBe('pending');
    expect(out.action?.pending).toEqual({ target: 'event', entityId: eid });
    expect(await events.getById(OWNER, CAR_ID, eid)).not.toBeNull();
  });

  it('merges only the given fields when updating the car', async () => {
    const out = await build().execute({
      id: 't1', name: 'update_car', input: { mileage: 99000 },
    });
    expect(out.isError).toBe(false);
    const stored = await cars.getById(OWNER, CAR_ID);
    expect(stored!.mileage).toBe(99000);
    expect(stored!.nickname).toBe('Wolfie'); // preserved
    expect(stored!.make).toBe('VW');
  });

  it('rejects an update_car with no fields', async () => {
    const out = await build().execute({ id: 't1', name: 'update_car', input: {} });
    expect(out.isError).toBe(true);
  });

  it('answers search_events from the full timeline', async () => {
    const timeline: Event[] = [{
      id: 'old-1', carId: CAR_ID, ownerId: OWNER, date: '2015-03-01', category: 'brakes',
      mileage: 40000, cost: 900, currency: 'UAH', title: 'Rear pads', notes: undefined, works: [],
      createdAt: '2015-03-01T00:00:00.000Z', updatedAt: '2015-03-01T00:00:00.000Z',
    }];
    const out = await build(timeline).execute({
      id: 't1', name: 'search_events', input: { category: 'brakes' },
    });
    expect(out.isError).toBe(false);
    expect(out.content).toContain('2015-03-01');
    expect(out.content).toContain('Rear pads');
    expect(out.action).toBeUndefined(); // reads are not side effects
  });

  it('answers sum_spend per currency', async () => {
    const mk = (id: string, cost: number, currency: string): Event => ({
      id, carId: CAR_ID, ownerId: OWNER, date: '2020-01-01', category: 'other',
      mileage: 1, cost, currency, title: undefined, notes: undefined, works: [],
      createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    });
    const out = await build([mk('a', 100, 'UAH'), mk('b', 5, 'USD')]).execute({
      id: 't1', name: 'sum_spend', input: {},
    });
    expect(out.content).toContain('100 UAH');
    expect(out.content).toContain('5 USD');
    expect(out.action).toBeUndefined();
  });

  it('reports an unknown tool as an error rather than throwing', async () => {
    const out = await build().execute({ id: 't1', name: 'drop_database', input: {} });
    expect(out.isError).toBe(true);
    expect(out.content.toLowerCase()).toContain('unknown tool');
  });

  it('cannot reach another owner entity', async () => {
    // The foreign row lives in the SAME `reminders` instance the executor holds (finding 2:
    // the original version of this test wrote it into a separate InMemoryReminderRepository,
    // which made the lookup fail for a trivial reason — the executor never even looked at
    // the right store — rather than because of real owner scoping). A reviewer confirmed
    // that with the foreign row in a separate instance, a mutant executor that trusts
    // input.ownerId over deps.ownerId still passed all 15 tests. See the report for the
    // before/after evidence of applying and reverting that mutant against this version.
    const foreign: Reminder = {
      id: '44444444-4444-4444-8444-444444444444', carId: CAR_ID, ownerId: 'someone-else',
      title: 'Not yours', category: 'other', dueMileage: 1, notes: undefined,
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    };
    await reminders.create(foreign);
    // Our executor is scoped to OWNER, so the id resolves to nothing — even though the
    // model could try to smuggle a different ownerId in the tool input.
    const out = await build().execute({
      id: 't1', name: 'update_reminder',
      input: { id: foreign.id, ownerId: 'someone-else', dueMileage: 2 },
    });
    expect(out.isError).toBe(true);
    expect(out.content.toLowerCase()).toContain('no reminder');
    expect((await reminders.getById('someone-else', CAR_ID, foreign.id))!.dueMileage).toBe(1); // untouched
  });

  describe('finding 1: stale car snapshot across calls in a turn', () => {
    it('does not let a later, lower-mileage event drop the odometer back down', async () => {
      const executor = build();
      const first = await executor.execute({
        id: 't1', name: 'create_event',
        input: { date: '2026-08-01', mileage: 95000, category: 'oil_change', cost: 100 },
      });
      expect(first.isError).toBe(false);
      expect((await cars.getById(OWNER, CAR_ID))!.mileage).toBe(95000);

      // A second car-touching call on the SAME executor instance — deps.car is still the
      // 90000 snapshot captured at construction. Without a fresh read, bumpCarMileage(stale
      // 90000, 92000) says "bump" and the stored 95000 would be overwritten with 92000.
      const second = await executor.execute({
        id: 't2', name: 'create_event',
        input: { date: '2026-08-02', mileage: 92000, category: 'other', cost: 0 },
      });
      expect(second.isError).toBe(false);
      expect((await cars.getById(OWNER, CAR_ID))!.mileage).toBe(95000); // must NOT drop to 92000
    });

    it('does not let a car-touching create_event revert an update_car made earlier in the turn', async () => {
      const executor = build();
      const renamed = await executor.execute({
        id: 't1', name: 'update_car', input: { nickname: 'Renamed' },
      });
      expect(renamed.isError).toBe(false);
      expect((await cars.getById(OWNER, CAR_ID))!.nickname).toBe('Renamed');

      const logged = await executor.execute({
        id: 't2', name: 'create_event',
        input: { date: '2026-08-02', mileage: 91000, category: 'other', cost: 0 },
      });
      expect(logged.isError).toBe(false);
      // The stale deps.car snapshot has nickname 'Wolfie' — rebuilding the car from it would
      // revert the rename that just happened.
      expect((await cars.getById(OWNER, CAR_ID))!.nickname).toBe('Renamed');
    });

    it('does not let a second update_car in one turn revert the first', async () => {
      const executor = build();
      await executor.execute({ id: 't1', name: 'update_car', input: { nickname: 'First' } });
      const out = await executor.execute({ id: 't2', name: 'update_car', input: { licensePlate: 'AA1234BB' } });
      expect(out.isError).toBe(false);
      const stored = await cars.getById(OWNER, CAR_ID);
      expect(stored!.nickname).toBe('First'); // must not revert to 'Wolfie'
      expect(stored!.licensePlate).toBe('AA1234BB');
    });
  });

  describe('finding 4: read tools validate their inputs instead of silently coercing', () => {
    it('rejects a non-numeric limit as an error instead of reporting an empty result', async () => {
      const timeline: Event[] = [{
        id: 'e1', carId: CAR_ID, ownerId: OWNER, date: '2020-01-01', category: 'other',
        mileage: 1, cost: 1, currency: 'UAH', title: 'x', notes: undefined, works: [],
        createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
      }];
      const out = await build(timeline).execute({
        id: 't1', name: 'search_events', input: { limit: 'many' },
      });
      expect(out.isError).toBe(true);
      expect(out.content).not.toContain('No matching entries'); // must not fabricate an empty result
    });

    it('rejects a bogus category as an error instead of reporting an empty result', async () => {
      const out = await build().execute({
        id: 't1', name: 'search_events', input: { category: 'bogus_cat' },
      });
      expect(out.isError).toBe(true);
      expect(out.content).not.toContain('No matching entries');
    });

    it('rejects a bogus category for sum_spend as an error too', async () => {
      const out = await build().execute({
        id: 't1', name: 'sum_spend', input: { category: 'bogus_cat' },
      });
      expect(out.isError).toBe(true);
    });
  });

  describe('finding 5: null from the model means "not provided"', () => {
    it('create_reminder succeeds when an optional field is explicitly null', async () => {
      const out = await build().execute({
        id: 't1', name: 'create_reminder',
        input: { title: 'Oil', category: 'oil_change', dueMileage: 100000, notes: null },
      });
      expect(out.isError).toBe(false);
      const stored = await reminders.listByCar(OWNER, CAR_ID);
      expect(stored[0]!.notes).toBeUndefined();
    });
  });

  describe('finding 6: update_car summary only names fields that actually changed', () => {
    it('rejects an update_car where every key is unknown, without fabricating a summary', async () => {
      const out = await build().execute({
        id: 't1', name: 'update_car', input: { ownerId: 'EVIL', bogus: 1 },
      });
      expect(out.isError).toBe(true);
      expect(out.content).not.toContain('ownerId');
      expect(out.content).not.toContain('bogus');
      expect(out.action).toBeUndefined();
      const stored = await cars.getById(OWNER, CAR_ID);
      expect(stored!.ownerId).toBe(OWNER); // unchanged — the model cannot override ownerId
    });

    it('succeeds on a mixed input and mentions only the real, changed field', async () => {
      const out = await build().execute({
        id: 't1', name: 'update_car', input: { bogus: 1, mileage: 95000 },
      });
      expect(out.isError).toBe(false);
      expect(out.action!.summary).toContain('mileage');
      expect(out.action!.summary).not.toContain('bogus');
      expect((await cars.getById(OWNER, CAR_ID))!.mileage).toBe(95000);
    });
  });

  describe('finding 8: the summary is clamped to the ChatActionSchema cap', () => {
    it('keeps an adversarially long update_car summary within 200 chars', async () => {
      const longMake = 'A'.repeat(60);
      const longModel = 'B'.repeat(60);
      const out = await build().execute({
        id: 't1', name: 'update_car',
        input: {
          make: longMake, model: longModel, nickname: 'N', licensePlate: 'P',
          vin: '1HGCM82633A004352', engineVolume: 2, fuelType: 'petrol', year: 2020,
        },
      });
      expect(out.isError).toBe(false);
      expect(out.action!.summary.length).toBeLessThanOrEqual(200);
    });
  });
});
