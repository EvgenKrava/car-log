import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { Event, CreateEventInput } from '@carlog/contracts';
import { EventNotFoundError, type EventRepository } from '@carlog/domain';
import { eventSk, isEventRow } from './event-key';

const pk = (ownerId: string) => `USER#${ownerId}`;
type Row = Event & { PK: string; SK: string };
const toRow = (e: Event): Row => ({ ...e, PK: pk(e.ownerId), SK: eventSk(e.carId, e.id) });
const toEvent = (row: Record<string, unknown>): Event => {
  const { PK, SK, ...event } = row as Row;
  return event;
};

export class DynamoEventRepository implements EventRepository {
  constructor(private readonly tableName: string, private readonly client: DynamoDBDocumentClient) {}

  async create(event: Event): Promise<Event> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(event) }));
    return event;
  }
  async listByCar(ownerId: string, carId: string): Promise<Event[]> {
    const res = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk(ownerId), ':sk': `CAR#${carId}#EVENT#` },
    }));
    // begins_with also matches proof rows (…#PROOF#…) — exclude in code (SK is a key attr; can't FilterExpression it).
    return (res.Items ?? []).filter((i) => isEventRow(String((i as Row).SK))).map(toEvent);
  }
  async getById(ownerId: string, carId: string, eventId: string): Promise<Event | null> {
    const res = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { PK: pk(ownerId), SK: eventSk(carId, eventId) } }));
    return res.Item ? toEvent(res.Item) : null;
  }
  async update(ownerId: string, carId: string, eventId: string, input: CreateEventInput): Promise<Event> {
    const existing = await this.getById(ownerId, carId, eventId);
    if (!existing) throw new EventNotFoundError(eventId);
    const updated: Event = { ...input, id: existing.id, carId, ownerId, createdAt: existing.createdAt, updatedAt: new Date().toISOString(), currency: input.currency ?? 'UAH', works: input.works ?? [] };
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(updated) }));
    return updated;
  }
  async delete(ownerId: string, carId: string, eventId: string): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { PK: pk(ownerId), SK: eventSk(carId, eventId) } }));
  }
  // v1: bounded cross-owner Scan (documented trade-off — reads broadly, doesn't scale;
  // a GSI keyed by a constant PK + createdAt sort is the later fix). Cap the pages
  // scanned so cost stays bounded, filter to event rows, sort newest-first.
  async recentAcrossOwners(limit: number): Promise<Event[]> {
    const collected: Event[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    let pages = 0;
    do {
      const res = await this.client.send(new ScanCommand({
        TableName: this.tableName, ExclusiveStartKey, Limit: 200,
      }));
      for (const item of res.Items ?? []) {
        if (isEventRow(String((item as Row).SK))) collected.push(toEvent(item));
      }
      ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
      pages += 1;
    } while (ExclusiveStartKey && pages < 10);
    return collected.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
  }
}
