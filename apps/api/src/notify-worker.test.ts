import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Car } from '@carlog/contracts';
import type { CarRepository } from '@carlog/domain';
import { runNotifyJob, type NotifyDeps } from './notify-worker';
import { InMemoryPushSubscriptionRepository } from './in-memory-push-subscription-repository';
import { InMemoryCarRepository } from './in-memory-car-repository';
import { InMemoryReminderRepository } from './in-memory-reminder-repository';
import { InMemoryPushSender } from './in-memory-push-sender';
import type { PushSubscriptionRecord } from './push-subscription-repository';

const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';
const TODAY = '2026-08-08';

const car = (over: Partial<Car> = {}): Car => ({
  id: '11111111-1111-4111-8111-111111111111',
  ownerId: OWNER_A,
  make: 'VW',
  model: 'Golf',
  year: 2018,
  mileage: 50000,
  fuelType: 'diesel',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  mileageUpdatedAt: '2026-07-30T00:00:00.000Z', // 9 days before TODAY → stale
  shared: false,
  ...over,
});

const subscriptionRecord = (over: Partial<PushSubscriptionRecord> = {}): PushSubscriptionRecord => ({
  ownerId: OWNER_A,
  endpointHash: 'hash-a',
  subscription: { endpoint: 'https://push.example.com/sub/a', keys: { p256dh: 'p', auth: 'a' }, lang: 'en' },
  lang: 'en',
  lastNotified: {},
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

describe('runNotifyJob', () => {
  let subs: InMemoryPushSubscriptionRepository;
  let cars: InMemoryCarRepository;
  let reminders: InMemoryReminderRepository;
  let sender: InMemoryPushSender;

  beforeEach(() => {
    subs = new InMemoryPushSubscriptionRepository();
    cars = new InMemoryCarRepository();
    reminders = new InMemoryReminderRepository();
    sender = new InMemoryPushSender();
  });

  const deps = (extra: Partial<NotifyDeps> = {}): NotifyDeps => ({
    subs, cars, reminders, sender, remainingMs: () => 300_000, today: () => TODAY, ...extra,
  });

  it('processes two subscriptions, sending a mileage push for each owner\'s stale car', async () => {
    await cars.create(car({ id: '11111111-1111-4111-8111-111111111111', ownerId: OWNER_A }));
    await cars.create(car({ id: '22222222-2222-4222-8222-222222222222', ownerId: OWNER_B }));
    await subs.upsert(subscriptionRecord({ ownerId: OWNER_A, endpointHash: 'hash-a', subscription: { endpoint: 'https://push.example.com/sub/a', keys: { p256dh: 'p', auth: 'a' }, lang: 'en' } }));
    await subs.upsert(subscriptionRecord({ ownerId: OWNER_B, endpointHash: 'hash-b', subscription: { endpoint: 'https://push.example.com/sub/b', keys: { p256dh: 'p', auth: 'a' }, lang: 'en' } }));

    await runNotifyJob(deps(), { jobType: 'notify' });

    expect(sender.sent).toHaveLength(2);
    const rows = await subs.listAll();
    expect(rows.find((r) => r.ownerId === OWNER_A)?.lastNotified).toEqual({ '11111111-1111-4111-8111-111111111111#mileage': TODAY });
    expect(rows.find((r) => r.ownerId === OWNER_B)?.lastNotified).toEqual({ '22222222-2222-4222-8222-222222222222#mileage': TODAY });
  });

  it('a same-day double run sends nothing the second time (lastNotified persisted through the fake repo)', async () => {
    await cars.create(car());
    await subs.upsert(subscriptionRecord());

    await runNotifyJob(deps(), { jobType: 'notify' });
    expect(sender.sent).toHaveLength(1);

    await runNotifyJob(deps(), { jobType: 'notify' });
    expect(sender.sent).toHaveLength(1); // unchanged — second run sent nothing
  });

  it('a "gone" send result deletes the subscription row and does not save a map', async () => {
    await cars.create(car());
    const endpoint = 'https://push.example.com/sub/gone';
    sender.markGone(endpoint);
    await subs.upsert(subscriptionRecord({ subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' }, lang: 'en' } }));

    await runNotifyJob(deps(), { jobType: 'notify' });

    expect(await subs.listAll()).toHaveLength(0);
  });

  it('bails once the budget is exhausted, leaving later subscriptions untouched, and logs how many were skipped', async () => {
    await cars.create(car({ id: '11111111-1111-4111-8111-111111111111', ownerId: OWNER_A }));
    await cars.create(car({ id: '22222222-2222-4222-8222-222222222222', ownerId: OWNER_B }));
    await subs.upsert(subscriptionRecord({ ownerId: OWNER_A, endpointHash: 'hash-a', subscription: { endpoint: 'https://push.example.com/sub/a', keys: { p256dh: 'p', auth: 'a' }, lang: 'en' } }));
    await subs.upsert(subscriptionRecord({ ownerId: OWNER_B, endpointHash: 'hash-b', subscription: { endpoint: 'https://push.example.com/sub/b', keys: { p256dh: 'p', auth: 'a' }, lang: 'en' } }));

    let calls = 0;
    const budget = () => { calls++; return calls === 1 ? 300_000 : 10_000; };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await runNotifyJob(deps({ remainingMs: budget }), { jobType: 'notify' });

    expect(sender.sent).toHaveLength(1); // only the first subscription got processed
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('time budget'), 1);
    warnSpy.mockRestore();
  });

  it('the payload JSON carries the correct url for each condition type', async () => {
    const carId = car().id;
    await cars.create(car({ id: carId }));
    await reminders.create({
      id: '33333333-3333-4333-8333-333333333333', carId, ownerId: OWNER_A,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      title: 'Oil change', category: 'oil_change', dueDate: TODAY,
    });
    await subs.upsert(subscriptionRecord());

    await runNotifyJob(deps(), { jobType: 'notify' });

    const payloads = sender.sent.map((s) => JSON.parse(s.payload) as { url: string });
    expect(payloads.some((p) => p.url === `/cars/${carId}?odometer=1`)).toBe(true);
    expect(payloads.some((p) => p.url === `/cars/${carId}?tab=reminders`)).toBe(true);
  });

  it('a throwing car-load for one subscription does not stop the next', async () => {
    await cars.create(car({ id: '22222222-2222-4222-8222-222222222222', ownerId: OWNER_B }));
    await subs.upsert(subscriptionRecord({ ownerId: OWNER_A, endpointHash: 'hash-a', subscription: { endpoint: 'https://push.example.com/sub/a', keys: { p256dh: 'p', auth: 'a' }, lang: 'en' } }));
    await subs.upsert(subscriptionRecord({ ownerId: OWNER_B, endpointHash: 'hash-b', subscription: { endpoint: 'https://push.example.com/sub/b', keys: { p256dh: 'p', auth: 'a' }, lang: 'en' } }));

    const throwingCars: CarRepository = {
      create: cars.create.bind(cars),
      getById: cars.getById.bind(cars),
      update: cars.update.bind(cars),
      delete: cars.delete.bind(cars),
      setShared: cars.setShared.bind(cars),
      findSharedOwnerId: cars.findSharedOwnerId.bind(cars),
      listByOwner: async (ownerId: string) => {
        if (ownerId === OWNER_A) throw new Error('boom');
        return cars.listByOwner(ownerId);
      },
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runNotifyJob(deps({ cars: throwingCars }), { jobType: 'notify' });

    expect(sender.sent).toHaveLength(1); // owner B still processed
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
