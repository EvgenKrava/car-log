import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ImportJob } from '@carlog/contracts';

// The stored record carries the input source (inline text or S3 key) and the owner;
// neither is returned by the API (routes strip to the ImportJob shape).
export type ImportJobRecord = ImportJob & { ownerId: string; text?: string; s3Key?: string };

export interface ImportJobRepository {
  create(job: ImportJobRecord): Promise<void>;
  get(ownerId: string, carId: string, jobId: string): Promise<ImportJobRecord | null>;
  latestForCar(ownerId: string, carId: string): Promise<ImportJobRecord | null>;
  update(job: ImportJobRecord): Promise<void>;
  remove(ownerId: string, carId: string, jobId: string): Promise<void>;
}

export const importJobSk = (carId: string, jobId: string): string => `CAR#${carId}#IMPORT#${jobId}`;
const pk = (ownerId: string) => `USER#${ownerId}`;
const TTL_SECONDS = 24 * 60 * 60;

type Row = ImportJobRecord & { PK: string; SK: string; ttl: number };
const toRow = (j: ImportJobRecord): Row => ({
  ...j, PK: pk(j.ownerId), SK: importJobSk(j.carId, j.id),
  ttl: Math.floor(Date.parse(j.createdAt) / 1000) + TTL_SECONDS,
});
const toRecord = (row: Record<string, unknown>): ImportJobRecord => {
  const { PK, SK, ttl, ...job } = row as Row;
  return job;
};

export class DynamoImportJobRepository implements ImportJobRepository {
  constructor(private readonly tableName: string, private readonly client: DynamoDBDocumentClient) {}

  async create(job: ImportJobRecord): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(job) }));
  }
  async get(ownerId: string, carId: string, jobId: string): Promise<ImportJobRecord | null> {
    const res = await this.client.send(new GetCommand({
      TableName: this.tableName, Key: { PK: pk(ownerId), SK: importJobSk(carId, jobId) },
    }));
    return res.Item ? toRecord(res.Item) : null;
  }
  async latestForCar(ownerId: string, carId: string): Promise<ImportJobRecord | null> {
    const res = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk(ownerId), ':sk': `CAR#${carId}#IMPORT#` },
    }));
    const jobs = (res.Items ?? []).map(toRecord);
    if (jobs.length === 0) return null;
    jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return jobs[0] ?? null;
  }
  async update(job: ImportJobRecord): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(job) }));
  }
  async remove(ownerId: string, carId: string, jobId: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.tableName, Key: { PK: pk(ownerId), SK: importJobSk(carId, jobId) },
    }));
  }
}
