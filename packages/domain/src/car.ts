import { CreateCarSchema, type Car, type CreateCarInput } from '@carlog/contracts';
import { newId as defaultNewId, nowIso } from './id';

export type CreateCarDeps = { newId?: () => string; now?: () => string };

export function createCar(ownerId: string, input: CreateCarInput, deps: CreateCarDeps = {}): Car {
  const data = CreateCarSchema.parse(input);
  const id = (deps.newId ?? defaultNewId)();
  const timestamp = (deps.now ?? nowIso)();
  return { ...data, id, ownerId, createdAt: timestamp, updatedAt: timestamp };
}

export class CarNotFoundError extends Error {
  constructor(id: string) {
    super(`Car ${id} not found`);
    this.name = 'CarNotFoundError';
  }
}
