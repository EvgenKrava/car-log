import type { Car, CreateCarInput } from '@carlog/contracts';

export interface CarRepository {
  create(car: Car): Promise<Car>;
  listByOwner(ownerId: string): Promise<Car[]>;
  getById(ownerId: string, id: string): Promise<Car | null>;
  // mileageUpdatedAt: when given, persisted verbatim; when absent, the repo keeps the
  // stored value. The repo stays clock-free — callers (routes/domain) decide when the
  // odometer signal moves.
  update(ownerId: string, id: string, input: CreateCarInput, mileageUpdatedAt?: string): Promise<Car>;
  delete(ownerId: string, id: string): Promise<void>;
  setShared(ownerId: string, id: string, shared: boolean): Promise<Car>;
  findSharedOwnerId(carId: string): Promise<string | null>;
}
