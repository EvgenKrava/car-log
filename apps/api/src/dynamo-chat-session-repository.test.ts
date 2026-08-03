import { describe, expect, it } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { ChatSessionRecord } from '@carlog/domain';
import { DynamoChatSessionRepository } from './dynamo-chat-session-repository';

// Minimal fake: capture each command's input so we can assert the persisted item shape.
function fakeClient() {
  const inputs: Array<Record<string, unknown>> = [];
  const client = {
    send: async (cmd: { input: Record<string, unknown> }) => { inputs.push(cmd.input); return {}; },
  } as unknown as DynamoDBDocumentClient;
  return { client, inputs };
}

const session = (updatedAt: string): ChatSessionRecord => ({
  id: 's1', carId: 'c1', ownerId: 'u1', title: 'hi', messages: [], createdAt: updatedAt, updatedAt,
});

describe('DynamoChatSessionRepository', () => {
  it('writes keys + a 7-day epoch-SECONDS ttl derived from updatedAt', async () => {
    const { client, inputs } = fakeClient();
    const updatedAt = '2026-08-03T00:00:00.000Z';
    await new DynamoChatSessionRepository('tbl', client).create(session(updatedAt));

    const item = inputs[0]!.Item as Record<string, unknown>;
    expect(item.PK).toBe('USER#u1');
    expect(item.SK).toBe('CAR#c1#CHAT#s1');
    const expected = Math.floor(new Date(updatedAt).getTime() / 1000) + 7 * 24 * 60 * 60;
    expect(item.ttl).toBe(expected);
    // ttl is seconds, not milliseconds — guard against a units regression.
    expect(String(item.ttl).length).toBeLessThan(13);
  });

  it('refreshes ttl on save when updatedAt advances', async () => {
    const { client, inputs } = fakeClient();
    const repo = new DynamoChatSessionRepository('tbl', client);
    await repo.create(session('2026-08-03T00:00:00.000Z'));
    await repo.save(session('2026-08-10T00:00:00.000Z'));
    const firstTtl = (inputs[0]!.Item as { ttl: number }).ttl;
    const secondTtl = (inputs[1]!.Item as { ttl: number }).ttl;
    expect(secondTtl - firstTtl).toBe(7 * 24 * 60 * 60);
  });
});
