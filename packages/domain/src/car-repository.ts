import type { Car, CreateCarInput } from '@carlog/contracts';

export interface CarRepository {
  create(car: Car): Promise<Car>;
  listByOwner(ownerId: string): Promise<Car[]>;
  getById(ownerId: string, id: string): Promise<Car | null>;
  update(ownerId: string, id: string, input: CreateCarInput): Promise<Car>;
  delete(ownerId: string, id: string): Promise<void>;
  setShared(ownerId: string, id: string, shared: boolean): Promise<Car>;
  findSharedOwnerId(carId: string): Promise<string | null>;
}
