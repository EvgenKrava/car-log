import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { QuotaKind, UsageQuota } from '@carlog/domain';

const pk = (ownerId: string) => `USER#${ownerId}`;
const sk = (kind: QuotaKind, day: string) => `QUOTA#${kind}#${day}`;
// Rows expire two days after their window so a late-arriving read never sees a gap.
const ttlFor = (day: string): number => Math.floor((Date.parse(`${day}T00:00:00.000Z`) + 2 * 86_400_000) / 1000);

// One conditional UpdateItem per consume: ADD under a "< limit" condition is atomic, so
// concurrent requests can never overshoot the cap. No read-before-write.
export class DynamoUsageQuota implements UsageQuota {
  constructor(private readonly tableName: string, private readonly client: DynamoDBDocumentClient) {}

  async consume(ownerId: string, kind: QuotaKind, limit: number, day: string): Promise<boolean> {
    try {
      await this.client.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: pk(ownerId), SK: sk(kind, day) },
        UpdateExpression: 'ADD #c :one SET #ttl = :ttl',
        ConditionExpression: 'attribute_not_exists(#c) OR #c < :limit',
        ExpressionAttributeNames: { '#c': 'count', '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':one': 1, ':limit': limit, ':ttl': ttlFor(day) },
      }));
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return false;
      throw err;
    }
  }
}
