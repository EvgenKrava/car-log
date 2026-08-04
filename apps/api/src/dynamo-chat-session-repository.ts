import {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ChatSessionSummary } from '@carlog/contracts';
import { type ChatSessionRepository, type ChatSessionRecord } from '@carlog/domain';

const pk = (ownerId: string) => `USER#${ownerId}`;
const sk = (carId: string, sessionId: string) => `CAR#${carId}#CHAT#${sessionId}`;
const skPrefix = (carId: string) => `CAR#${carId}#CHAT#`;

// Sessions auto-expire 7 days after their last write (DynamoDB TTL on the `ttl` attribute,
// which the table already declares). Refreshed on every create/save.
const TTL_SECONDS = 7 * 24 * 60 * 60;
const ttlFrom = (updatedAt: string): number => Math.floor(new Date(updatedAt).getTime() / 1000) + TTL_SECONDS;

type Row = ChatSessionRecord & { PK: string; SK: string; ttl: number };
const toRow = (s: ChatSessionRecord): Row => ({ ...s, PK: pk(s.ownerId), SK: sk(s.carId, s.id), ttl: ttlFrom(s.updatedAt) });
const toSession = (row: Record<string, unknown>): ChatSessionRecord => {
  const { PK, SK, ttl, ...session } = row as Row;
  void PK; void SK; void ttl;
  // Sessions carry a 7-day TTL, so rows written before `actions` existed on StoredChatMessage
  // can still be read back for up to 7 days after that field shipped. Those rows have no
  // `actions` key at all — the Zod `.default([])` only helps parse(), which this boundary
  // doesn't call — so normalize it here to keep the runtime value matching the declared type.
  session.messages = session.messages.map((message) => ({ ...message, actions: message.actions ?? [] }));
  return session;
};

export class DynamoChatSessionRepository implements ChatSessionRepository {
  constructor(private readonly tableName: string, private readonly client: DynamoDBDocumentClient) {}

  async create(session: ChatSessionRecord): Promise<ChatSessionRecord> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(session) }));
    return session;
  }

  async listByCar(ownerId: string, carId: string): Promise<ChatSessionSummary[]> {
    const res = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk(ownerId), ':sk': skPrefix(carId) },
    }));
    return (res.Items ?? [])
      .map((item) => toSession(item))
      .map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt, messageCount: s.messages.length }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)); // newest-updated first
  }

  async getById(ownerId: string, carId: string, sessionId: string): Promise<ChatSessionRecord | null> {
    const res = await this.client.send(new GetCommand({
      TableName: this.tableName, Key: { PK: pk(ownerId), SK: sk(carId, sessionId) },
    }));
    return res.Item ? toSession(res.Item) : null;
  }

  async save(session: ChatSessionRecord): Promise<ChatSessionRecord> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(session) }));
    return session;
  }

  async delete(ownerId: string, carId: string, sessionId: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.tableName, Key: { PK: pk(ownerId), SK: sk(carId, sessionId) },
    }));
  }
}
