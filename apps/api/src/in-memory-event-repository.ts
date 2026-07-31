import type { Event, CreateEventInput } from '@carlog/contracts';
import { EventNotFoundError, type EventRepository } from '@carlog/domain';
import { eventSk, isEventRow } from './event-key';

export class InMemoryEventRepository implements EventRepository {
  // key: `${ownerId}|${SK}` → Event. One map, SK-shaped, so isEventRow filtering matters.
  private rows = new Map<string, Event>();
  private k(ownerId: string, sk: string) { return `${ownerId}|${sk}`; }

  async create(event: Event): Promise<Event> {
    this.rows.set(this.k(event.ownerId, eventSk(event.carId, event.id)), event);
    return event;
  }
  async listByCar(ownerId: string, carId: string): Promise<Event[]> {
    const prefix = `CAR#${carId}#EVENT#`;
    return [...this.rows.entries()]
      .filter(([key]) => key.startsWith(`${ownerId}|`))
      .map(([key, e]) => [key.slice(ownerId.length + 1), e] as const)
      .filter(([sk]) => sk.startsWith(prefix) && isEventRow(sk))
      .map(([, e]) => e);
  }
  async getById(ownerId: string, carId: string, eventId: string): Promise<Event | null> {
    return this.rows.get(this.k(ownerId, eventSk(carId, eventId))) ?? null;
  }
  async update(ownerId: string, carId: string, eventId: string, input: CreateEventInput): Promise<Event> {
    const existing = this.rows.get(this.k(ownerId, eventSk(carId, eventId)));
    if (!existing) throw new EventNotFoundError(eventId);
    const updated: Event = { ...input, id: existing.id, carId, ownerId, createdAt: existing.createdAt, updatedAt: new Date().toISOString(), currency: input.currency ?? 'UAH', works: input.works ?? [] };
    this.rows.set(this.k(ownerId, eventSk(carId, eventId)), updated);
    return updated;
  }
  async delete(ownerId: string, carId: string, eventId: string): Promise<void> {
    this.rows.delete(this.k(ownerId, eventSk(carId, eventId)));
  }
  async recentAcrossOwners(limit: number): Promise<Event[]> {
    return [...this.rows.values()]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
  }
}
