import { CreateCarSchema, type Car, type CreateCarInput } from '@carlog/contracts';
import { newId as defaultNewId, nowIso } from './id';

export type CreateCarDeps = { newId?: () => string; now?: () => string };

export function createCar(ownerId: string, input: CreateCarInput, deps: CreateCarDeps = {}): Car {
  const data = CreateCarSchema.parse(input);
  const id = (deps.newId ?? defaultNewId)();
  const timestamp = (deps.now ?? nowIso)();
  return { ...data, id, ownerId, createdAt: timestamp, updatedAt: timestamp, shared: false };
}

// Events (and reminder completions) carry odometer readings; the car's mileage
// field must never lag behind them. Returns the update input when a bump is
// needed, null when the reading isn't newer.
export function bumpCarMileage(car: Car, mileage: number): CreateCarInput | null {
  if (mileage <= car.mileage) return null;
  return {
    make: car.make, model: car.model, year: car.year, mileage,
    fuelType: car.fuelType, engineVolume: car.engineVolume,
    nickname: car.nickname, vin: car.vin, licensePlate: car.licensePlate,
  };
}

export class CarNotFoundError extends Error {
  constructor(id: string) {
    super(`Car ${id} not found`);
    this.name = 'CarNotFoundError';
  }
}
