import type { Event, CreateEventInput } from '@carlog/contracts';

export interface EventRepository {
  create(event: Event): Promise<Event>;
  listByCar(ownerId: string, carId: string): Promise<Event[]>;
  getById(ownerId: string, carId: string, eventId: string): Promise<Event | null>;
  update(ownerId: string, carId: string, eventId: string, input: CreateEventInput): Promise<Event>;
  delete(ownerId: string, carId: string, eventId: string): Promise<void>;
  recentAcrossOwners(limit: number): Promise<Event[]>;
}
