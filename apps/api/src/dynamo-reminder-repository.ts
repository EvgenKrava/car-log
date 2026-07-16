import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { Reminder, CreateReminderInput } from '@carlog/contracts';
import { ReminderNotFoundError, type ReminderRepository } from '@carlog/domain';
import { reminderSk, isReminderRow } from './reminder-key';

const pk = (ownerId: string) => `USER#${ownerId}`;
type Row = Reminder & { PK: string; SK: string };
const toRow = (r: Reminder): Row => ({ ...r, PK: pk(r.ownerId), SK: reminderSk(r.carId, r.id) });
const toReminder = (row: Record<string, unknown>): Reminder => {
  const { PK, SK, ...reminder } = row as Row;
  return reminder;
};

export class DynamoReminderRepository implements ReminderRepository {
  constructor(private readonly tableName: string, private readonly client: DynamoDBDocumentClient) {}

  async create(reminder: Reminder): Promise<Reminder> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(reminder) }));
    return reminder;
  }
  async listByCar(ownerId: string, carId: string): Promise<Reminder[]> {
    const res = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk(ownerId), ':sk': `CAR#${carId}#REMINDER#` },
    }));
    return (res.Items ?? []).filter((i) => isReminderRow(String((i as Row).SK))).map(toReminder);
  }
  async getById(ownerId: string, carId: string, reminderId: string): Promise<Reminder | null> {
    const res = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { PK: pk(ownerId), SK: reminderSk(carId, reminderId) } }));
    return res.Item ? toReminder(res.Item) : null;
  }
  async update(ownerId: string, carId: string, reminderId: string, input: CreateReminderInput): Promise<Reminder> {
    const existing = await this.getById(ownerId, carId, reminderId);
    if (!existing) throw new ReminderNotFoundError(reminderId);
    const updated: Reminder = { ...input, id: existing.id, carId, ownerId, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(updated) }));
    return updated;
  }
  async delete(ownerId: string, carId: string, reminderId: string): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { PK: pk(ownerId), SK: reminderSk(carId, reminderId) } }));
  }
}
