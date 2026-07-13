import type { Car, UpdateCarInput } from '@carlog/contracts';

export interface CarRepository {
  create(car: Car): Promise<Car>;
  listByOwner(ownerId: string): Promise<Car[]>;
  getById(ownerId: string, id: string): Promise<Car | null>;
  update(ownerId: string, id: string, patch: UpdateCarInput): Promise<Car>;
  delete(ownerId: string, id: string): Promise<void>;
}
