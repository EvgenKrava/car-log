import { describe, expect, it, vi } from 'vitest';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoUsageQuota } from './dynamo-usage-quota';

const clientWith = (send: (cmd: unknown) => Promise<unknown>) =>
  ({ send } as unknown as DynamoDBDocumentClient);

describe('DynamoUsageQuota', () => {
  it('increments with a conditional ADD under the user PK and a 2-day TTL', async () => {
    const sent: unknown[] = [];
    const send = vi.fn(async (cmd: unknown) => { sent.push(cmd); return {}; });
    const quota = new DynamoUsageQuota('T', clientWith(send));
    await expect(quota.consume('u1', 'chat', 50, '2026-09-14')).resolves.toBe(true);
    const cmd = sent[0];
    if (!(cmd instanceof UpdateCommand)) throw new Error('expected an UpdateCommand');
    expect(cmd.input.Key).toEqual({ PK: 'USER#u1', SK: 'QUOTA#chat#2026-09-14' });
    expect(cmd.input.UpdateExpression).toBe('ADD #c :one SET #ttl = :ttl');
    expect(cmd.input.ConditionExpression).toBe('attribute_not_exists(#c) OR #c < :limit');
    expect(cmd.input.ExpressionAttributeValues).toEqual({
      ':one': 1, ':limit': 50, ':ttl': Math.floor(Date.parse('2026-09-16T00:00:00.000Z') / 1000),
    });
  });

  it('returns false when the condition fails', async () => {
    const send = vi.fn(async () => { throw new ConditionalCheckFailedException({ message: 'x', $metadata: {} }); });
    const quota = new DynamoUsageQuota('T', clientWith(send));
    await expect(quota.consume('u1', 'chat', 50, '2026-09-14')).resolves.toBe(false);
  });

  it('rethrows other errors', async () => {
    const send = vi.fn(async () => { throw new Error('boom'); });
    const quota = new DynamoUsageQuota('T', clientWith(send));
    await expect(quota.consume('u1', 'chat', 50, '2026-09-14')).rejects.toThrow('boom');
  });
});
