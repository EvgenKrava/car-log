import { describe, expect, it, vi } from 'vitest';
import { BatchWriteCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoUserDataRepository } from './dynamo-user-data-repository';

type Key = { PK: string; SK: string };
type BatchReq = { DeleteRequest: { Key: Key } };

describe('DynamoUserDataRepository.deleteAllForOwner', () => {
  it('queries keys under the owner PK page by page and batch-deletes in 25s, retrying unprocessed', async () => {
    const keys: Key[] = Array.from({ length: 30 }, (_, i) => ({ PK: 'USER#u1', SK: `ROW#${i}` }));
    const batches: number[] = [];
    let unprocessedOnce = false;
    const send = vi.fn(async (cmd: unknown) => {
      if (cmd instanceof QueryCommand) {
        return cmd.input.ExclusiveStartKey
          ? { Items: keys.slice(20) }
          : { Items: keys.slice(0, 20), LastEvaluatedKey: keys[19] };
      }
      if (cmd instanceof BatchWriteCommand) {
        const reqs = (cmd.input.RequestItems?.['T'] ?? []) as BatchReq[];
        batches.push(reqs.length);
        // First full batch: pretend one item came back unprocessed once.
        if (reqs.length === 20 && !unprocessedOnce) {
          unprocessedOnce = true;
          return { UnprocessedItems: { T: [reqs[0]] } };
        }
        return { UnprocessedItems: {} };
      }
      return {};
    });
    const repo = new DynamoUserDataRepository('T', { send } as unknown as DynamoDBDocumentClient);
    const n = await repo.deleteAllForOwner('u1');
    expect(n).toBe(30);
    const q = send.mock.calls.map((c) => c[0]).filter((c): c is QueryCommand => c instanceof QueryCommand);
    expect(q[0]?.input.KeyConditionExpression).toBe('PK = :pk');
    expect(q[0]?.input.ExpressionAttributeValues).toEqual({ ':pk': 'USER#u1' });
    expect(q[0]?.input.ProjectionExpression).toBe('PK, SK');
    // page 1 = 20 keys → one batch of 20 (+1 retry of the unprocessed key); page 2 = 10 keys.
    expect(batches).toEqual([20, 1, 10]);
  });
});
