import type { PushSubscription } from '@carlog/contracts';
import {
  decideNotifications, evaluateCarConditions, type CarRepository, type NotifyCondition,
  type ReminderRepository,
} from '@carlog/domain';
import { notifyCopy } from './notify-copy';
import type { PushSubscriptionRecord, PushSubscriptionRepository } from './push-subscription-repository';

export type NotifyWorkPayload = { jobType: 'notify' };

// Task 4 provides the real implementation (web-push); defined here so the worker and its
// tests don't depend on that file landing first.
export interface PushSender {
  send(subscription: PushSubscription, payload: string): Promise<'ok' | 'gone'>;
}

export type NotifyDeps = {
  subs: PushSubscriptionRepository;
  cars: CarRepository;
  reminders: ReminderRepository;
  sender: PushSender;
  remainingMs: () => number;
  today?: () => string;
};

// Same detached-invocation time budget shape as the import worker (MIN_BUDGET_MS there),
// but subscription rows are cheap to process one at a time, so the threshold is smaller.
const MIN_BUDGET_MS = 30_000;

const defaultToday = (): string => new Date().toISOString().slice(0, 10);

const lastNotifiedChanged = (before: Record<string, string>, after: Record<string, string>): boolean => {
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  if (beforeKeys.length !== afterKeys.length) return true;
  return afterKeys.some((key) => before[key] !== after[key]);
};

// One subscription row: evaluate every one of its owner's cars, decide what fires today,
// send, then persist the dedupe map (or delete the row if the push endpoint is gone).
// Conditions from ALL of the owner's cars are merged into a single decideNotifications
// call so pruning of cleared keys and re-notify timing are computed against one
// consistent snapshot of `lastNotified`, not per-car slices of it.
async function processSubscription(deps: NotifyDeps, row: PushSubscriptionRecord, today: string): Promise<void> {
  const cars = await deps.cars.listByOwner(row.ownerId);
  const carsById = new Map(cars.map((car) => [car.id, car] as const));

  const conditions: NotifyCondition[] = [];
  for (const car of cars) {
    const reminders = await deps.reminders.listByCar(row.ownerId, car.id);
    conditions.push(...evaluateCarConditions(car, reminders, today));
  }

  const { send, nextLastNotified } = decideNotifications(conditions, row.lastNotified, today);

  let gone = false;
  for (const cond of send) {
    const car = carsById.get(cond.carId);
    if (!car) continue; // condition referenced a car that vanished between evaluation and send
    const payload = JSON.stringify(notifyCopy(cond, car, row.lang));
    const result = await deps.sender.send(row.subscription, payload);
    if (result === 'gone') {
      gone = true;
      break; // same endpoint for every send in this row — further attempts would just repeat 'gone'
    }
  }

  if (gone) {
    await deps.subs.delete(row.ownerId, row.endpointHash);
    return;
  }
  if (lastNotifiedChanged(row.lastNotified, nextLastNotified)) {
    await deps.subs.saveLastNotified(row.ownerId, row.endpointHash, nextLastNotified);
  }
}

// Detached-invocation entry point (EventBridge cron self-invoke, like the import worker):
// scans every push-subscription row and, budget permitting, evaluates + sends for each.
// A failure processing one row (bad data, a repository error, a throwing sender) is
// caught and logged — it must never stop the remaining rows from being processed.
export async function runNotifyJob(deps: NotifyDeps, payload: NotifyWorkPayload): Promise<void> {
  void payload; // no fields beyond the discriminant; kept for symmetry with the import worker
  const today = (deps.today ?? defaultToday)();
  const rows = await deps.subs.listAll();

  for (let i = 0; i < rows.length; i++) {
    if (deps.remainingMs() < MIN_BUDGET_MS) {
      console.warn('notify worker: time budget exceeded, skipping remaining subscriptions', rows.length - i);
      break;
    }
    const row = rows[i]!;
    try {
      await processSubscription(deps, row, today);
    } catch (err) {
      console.error('notify worker: subscription failed', row.ownerId, err);
    }
  }
}
