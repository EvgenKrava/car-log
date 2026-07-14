import { CreateEventSchema, type Event, type CreateEventInput } from '@carlog/contracts';
import { newId as defaultNewId, nowIso } from './id';

export type CreateEventDeps = { newId?: () => string; now?: () => string };

export function createEvent(
  ownerId: string, carId: string, input: CreateEventInput, deps: CreateEventDeps = {},
): Event {
  const data = CreateEventSchema.parse(input);
  const timestamp = (deps.now ?? nowIso)();
  return {
    ...data,
    id: (deps.newId ?? defaultNewId)(),
    carId,
    ownerId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export class EventNotFoundError extends Error {
  constructor(id: string) { super(`Event ${id} not found`); this.name = 'EventNotFoundError'; }
}
export class ProofNotFoundError extends Error {
  constructor(id: string) { super(`Proof ${id} not found`); this.name = 'ProofNotFoundError'; }
}
