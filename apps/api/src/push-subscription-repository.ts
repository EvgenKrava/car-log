import {
  DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type { PushSubscription } from '@carlog/contracts';

// One row per (owner, endpoint). `endpointHash` is a sha256 hex digest of the endpoint
// URL (first 32 chars — API layer concern, computed with node:crypto in push-routes.ts;
// domain/contracts stay crypto-free). `lastNotified` is the notify worker's dedupe
// memory: `<carId>#<type>` -> ISO date of the last push sent for that condition.
export type PushSubscriptionRecord = {
  ownerId: string;
  endpointHash: string;
  subscription: PushSubscription;
  lang: 'uk' | 'en';
  lastNotified: Record<string, string>;
  updatedAt: string;
};

export interface PushSubscriptionRepository {
  // Re-subscribing the same endpoint (TTL refresh, endpoint rotation safety) must NOT
  // wipe the dedupe memory — implementations preserve the existing row's `lastNotified`
  // when one exists for the same (ownerId, endpointHash) key.
  upsert(rec: PushSubscriptionRecord): Promise<void>;
  listAll(): Promise<PushSubscriptionRecord[]>;
  delete(ownerId: string, endpointHash: string): Promise<void>;
  saveLastNotified(ownerId: string, endpointHash: string, map: Record<string, string>): Promise<void>;
}

const pk = (ownerId: string) => `USER#${ownerId}`;
const sk = (endpointHash: string) => `PUSH#${endpointHash}`;
const SK_PREFIX = 'PUSH#';

// Subscription rows auto-expire 180 days after their last write (DynamoDB TTL on the
// `ttl` attribute the table already declares). Refreshed on every upsert (subscribe /
// re-subscribe); NOT touched by saveLastNotified, which only updates the dedupe map.
const TTL_SECONDS = 180 * 24 * 60 * 60;
const ttlFrom = (updatedAt: string): number => Math.floor(new Date(updatedAt).getTime() / 1000) + TTL_SECONDS;

type Row = PushSubscriptionRecord & { PK: string; SK: string; ttl: number };
const toRow = (r: PushSubscriptionRecord): Row => ({ ...r, PK: pk(r.ownerId), SK: sk(r.endpointHash), ttl: ttlFrom(r.updatedAt) });
const toRecord = (row: Record<string, unknown>): PushSubscriptionRecord => {
  const { PK, SK, ttl, ...record } = row as Row;
  void PK; void SK; void ttl;
  return record;
};

export class DynamoPushSubscriptionRepository implements PushSubscriptionRepository {
  constructor(private readonly tableName: string, private readonly client: DynamoDBDocumentClient) {}

  // Read-modify-write: an existing row for the same (ownerId, endpointHash) key keeps its
  // lastNotified map — re-subscribing (TTL refresh, endpoint rotation) must not reset the
  // notify worker's dedupe memory.
  async upsert(rec: PushSubscriptionRecord): Promise<void> {
    const res = await this.client.send(new GetCommand({
      TableName: this.tableName, Key: { PK: pk(rec.ownerId), SK: sk(rec.endpointHash) },
    }));
    const existing = res.Item ? toRecord(res.Item) : null;
    const merged: PushSubscriptionRecord = { ...rec, lastNotified: existing?.lastNotified ?? rec.lastNotified };
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(merged) }));
  }

  // v1: bounded Scan (same documented trade-off as recentAcrossOwners in
  // dynamo-event-repository.ts) — reads broadly, doesn't scale; a GSI is the later fix.
  // Cap the pages scanned so cost stays bounded; filter to subscription rows in code
  // (FilterExpression can't reference the SK key attribute).
  async listAll(): Promise<PushSubscriptionRecord[]> {
    const collected: PushSubscriptionRecord[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    let pages = 0;
    do {
      const res = await this.client.send(new ScanCommand({
        TableName: this.tableName, ExclusiveStartKey, Limit: 200,
      }));
      for (const item of res.Items ?? []) {
        if (String((item as Row).SK).startsWith(SK_PREFIX)) collected.push(toRecord(item));
      }
      ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
      pages += 1;
    } while (ExclusiveStartKey && pages < 10);
    return collected;
  }

  async delete(ownerId: string, endpointHash: string): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { PK: pk(ownerId), SK: sk(endpointHash) } }));
  }

  async saveLastNotified(ownerId: string, endpointHash: string, map: Record<string, string>): Promise<void> {
    const res = await this.client.send(new GetCommand({
      TableName: this.tableName, Key: { PK: pk(ownerId), SK: sk(endpointHash) },
    }));
    if (!res.Item) return; // subscription gone (e.g. deleted concurrently) — nothing to save into
    const existing = toRecord(res.Item);
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow({ ...existing, lastNotified: map }) }));
  }
}
