import type { Car, CreateCarInput } from '@carlog/contracts';
import { CarNotFoundError, type CarRepository } from '@carlog/domain';

export class InMemoryCarRepository implements CarRepository {
  private cars = new Map<string, Car>();
  private key(ownerId: string, id: string) { return `${ownerId}#${id}`; }

  async create(car: Car): Promise<Car> {
    this.cars.set(this.key(car.ownerId, car.id), car);
    return car;
  }
  async listByOwner(ownerId: string): Promise<Car[]> {
    return [...this.cars.values()].filter((c) => c.ownerId === ownerId);
  }
  async getById(ownerId: string, id: string): Promise<Car | null> {
    return this.cars.get(this.key(ownerId, id)) ?? null;
  }
  async update(ownerId: string, id: string, input: CreateCarInput): Promise<Car> {
    const existing = this.cars.get(this.key(ownerId, id));
    if (!existing) throw new CarNotFoundError(id);
    const updated: Car = {
      ...input,
      id: existing.id,
      ownerId: existing.ownerId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.cars.set(this.key(ownerId, id), updated);
    return updated;
  }
  async delete(ownerId: string, id: string): Promise<void> {
    if (!this.cars.delete(this.key(ownerId, id))) throw new CarNotFoundError(id);
  }
}
