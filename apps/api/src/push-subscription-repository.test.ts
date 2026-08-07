import { describe, expect, it } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoPushSubscriptionRepository, type PushSubscriptionRecord } from './push-subscription-repository';

// Minimal fake: capture each command by constructor name + input, and let a test-supplied
// map answer GetCommands (same shape as the chat-session-repository fake).
function fakeClient(getResults: Array<Record<string, unknown> | undefined> = []) {
  const inputs: Array<{ name: string; input: Record<string, unknown> }> = [];
  let getIndex = 0;
  const client = {
    send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      inputs.push({ name: cmd.constructor.name, input: cmd.input });
      if (cmd.constructor.name === 'GetCommand') {
        const item = getResults[getIndex];
        getIndex += 1;
        return { Item: item };
      }
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
  return { client, inputs };
}

const record = (endpointHash: string, updatedAt: string, lastNotified: Record<string, string> = {}): PushSubscriptionRecord => ({
  ownerId: 'u1',
  endpointHash,
  subscription: { endpoint: 'https://push.example.com/sub/1', keys: { p256dh: 'p', auth: 'a' }, lang: 'en' },
  lang: 'en',
  lastNotified,
  updatedAt,
});

describe('DynamoPushSubscriptionRepository', () => {
  it('writes keys + a 180-day epoch-SECONDS ttl derived from updatedAt', async () => {
    const { client, inputs } = fakeClient([undefined]); // no existing row
    const updatedAt = '2026-08-07T00:00:00.000Z';
    await new DynamoPushSubscriptionRepository('tbl', client).upsert(record('hash1', updatedAt));

    const put = inputs.find((i) => i.name === 'PutCommand')!;
    const item = put.input.Item as Record<string, unknown>;
    expect(item.PK).toBe('USER#u1');
    expect(item.SK).toBe('PUSH#hash1');
    const expected = Math.floor(new Date(updatedAt).getTime() / 1000) + 180 * 24 * 60 * 60;
    expect(item.ttl).toBe(expected);
    expect(String(item.ttl).length).toBeLessThan(13); // seconds, not ms
  });

  it('preserves an existing lastNotified map when re-subscribing the same endpoint', async () => {
    const existing = record('hash1', '2026-08-01T00:00:00.000Z', { 'car1#mileage': '2026-08-01' });
    const { client, inputs } = fakeClient([existing]);
    await new DynamoPushSubscriptionRepository('tbl', client).upsert(record('hash1', '2026-08-07T00:00:00.000Z', {}));

    const put = inputs.find((i) => i.name === 'PutCommand')!;
    const item = put.input.Item as Record<string, unknown>;
    expect(item.lastNotified).toEqual({ 'car1#mileage': '2026-08-01' });
  });

  it('listAll filters to PUSH# rows and pages a bounded Scan', async () => {
    const rows = [
      { PK: 'USER#u1', SK: 'PUSH#hash1', ...record('hash1', '2026-08-07T00:00:00.000Z') },
      { PK: 'USER#u1', SK: 'CAR#c1', make: 'VW' }, // non-subscription row must be filtered out
    ];
    const client = {
      send: async (cmd: { constructor: { name: string } }) => {
        if (cmd.constructor.name === 'ScanCommand') return { Items: rows };
        return {};
      },
    } as unknown as DynamoDBDocumentClient;
    const result = await new DynamoPushSubscriptionRepository('tbl', client).listAll();
    expect(result).toHaveLength(1);
    expect(result[0]?.endpointHash).toBe('hash1');
  });

  it('delete removes the row for the given owner + endpointHash', async () => {
    const { client, inputs } = fakeClient();
    await new DynamoPushSubscriptionRepository('tbl', client).delete('u1', 'hash1');
    const del = inputs.find((i) => i.name === 'DeleteCommand')!;
    expect(del.input.Key).toEqual({ PK: 'USER#u1', SK: 'PUSH#hash1' });
  });

  it('saveLastNotified only updates the map, keeping the rest of the row', async () => {
    const existing = record('hash1', '2026-08-01T00:00:00.000Z', {});
    const { client, inputs } = fakeClient([existing]);
    await new DynamoPushSubscriptionRepository('tbl', client).saveLastNotified('u1', 'hash1', { 'car1#mileage': '2026-08-07' });

    const put = inputs.find((i) => i.name === 'PutCommand')!;
    const item = put.input.Item as Record<string, unknown>;
    expect(item.lastNotified).toEqual({ 'car1#mileage': '2026-08-07' });
    expect(item.subscription).toEqual(existing.subscription);
  });

  it('saveLastNotified is a no-op when the subscription is gone', async () => {
    const { client, inputs } = fakeClient([undefined]);
    await new DynamoPushSubscriptionRepository('tbl', client).saveLastNotified('u1', 'gone', { x: '1' });
    expect(inputs.some((i) => i.name === 'PutCommand')).toBe(false);
  });
});
