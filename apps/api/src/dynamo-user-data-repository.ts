import { BatchWriteCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { UserDataRepository } from '@carlog/domain';

type Key = { PK: string; SK: string };
const BATCH = 25; // BatchWriteItem hard limit

export class DynamoUserDataRepository implements UserDataRepository {
  constructor(private readonly tableName: string, private readonly client: DynamoDBDocumentClient) {}

  async deleteAllForOwner(ownerId: string): Promise<number> {
    let deleted = 0;
    let cursor: Record<string, unknown> | undefined;
    do {
      const page = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `USER#${ownerId}` },
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey: cursor,
      }));
      const keys = (page.Items ?? []) as Key[];
      for (let i = 0; i < keys.length; i += BATCH) {
        const slice = keys.slice(i, i + BATCH);
        await this.deleteBatch(slice);
        deleted += slice.length;
      }
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    return deleted;
  }

  // Retries unprocessed items until the batch drains — DynamoDB may throttle partially.
  private async deleteBatch(keys: Key[]): Promise<void> {
    let pending = keys.map((Key) => ({ DeleteRequest: { Key } }));
    while (pending.length > 0) {
      const res = await this.client.send(new BatchWriteCommand({ RequestItems: { [this.tableName]: pending } }));
      pending = (res.UnprocessedItems?.[this.tableName] ?? []) as typeof pending;
    }
  }
}
