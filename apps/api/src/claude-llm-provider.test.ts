import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { CHAT_TOOLS, type CarChatContext } from '@carlog/domain';
import { ClaudeLlmProvider, type MessagesClient } from './claude-llm-provider';
import { MODEL_SPECS } from './ai-models';
import { LlmUnavailableError } from './llm-errors';

const message = (over: Partial<Anthropic.Message>): Anthropic.Message => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'm', content: [],
  stop_reason: 'end_turn', stop_sequence: null, container: null,
  usage: {} as Anthropic.Usage, ...over,
} as Anthropic.Message);

const fakeClient = (res: Anthropic.Message | Error) => {
  const create = vi.fn(async () => { if (res instanceof Error) throw res; return res; });
  return { client: { messages: { create } } as unknown as MessagesClient, create };
};

const ctx: CarChatContext = {
  car: { make: 'VW', model: 'Golf', fuelType: 'petrol', mileage: 1000 },
  events: [], reminders: [],
};

const paramsOf = (create: ReturnType<typeof fakeClient>['create']) =>
  (create.mock.calls[0] as unknown as [Anthropic.MessageCreateParamsNonStreaming])[0];

describe('ClaudeLlmProvider', () => {
  it('sends effort to Haiku 5.5 and leaves it out for Haiku 4.5 (which 400s on it)', async () => {
    for (const [spec, expected] of [
      [MODEL_SPECS.anthropic['claude-haiku-5-5'], { effort: 'low' }],
      [MODEL_SPECS.bedrock['claude-haiku-4-5'], undefined],
    ] as const) {
      const { client, create } = fakeClient(message({ content: [{ type: 'text', text: 'hi', citations: null }] }));
      await new ClaudeLlmProvider({ client, model: spec, label: 't' })
        .chatTurn([{ role: 'user', content: 'hi' }], ctx, [], CHAT_TOOLS, 'auto');
      expect(paramsOf(create).model).toBe(spec.id);
      expect(paramsOf(create).output_config).toEqual(expected);
    }
  });

  it('keeps the tools on the final text-only round and only switches tool_choice', async () => {
    const { client, create } = fakeClient(message({ content: [{ type: 'text', text: 'done', citations: null }] }));
    await new ClaudeLlmProvider({ client, model: MODEL_SPECS.anthropic['claude-haiku-5-5'], label: 't' })
      .chatTurn([{ role: 'user', content: 'hi' }], ctx, [], CHAT_TOOLS, 'none');
    expect(paramsOf(create).tools).toHaveLength(CHAT_TOOLS.length);
    expect(paramsOf(create).tool_choice).toEqual({ type: 'none' });
  });

  it('returns text and tool calls from the response', async () => {
    const { client } = fakeClient(message({
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Adding it.', citations: null },
        { type: 'tool_use', id: 'tu_1', name: 'create_reminder', input: { title: 'Oil' }, caller: { type: 'direct' } } as Anthropic.ToolUseBlock,
      ],
    }));
    const res = await new ClaudeLlmProvider({ client, model: MODEL_SPECS.anthropic['claude-haiku-5-5'], label: 't' })
      .chatTurn([{ role: 'user', content: 'remind me' }], ctx, [], CHAT_TOOLS, 'auto');
    expect(res.text).toBe('Adding it.');
    expect(res.toolCalls).toEqual([{ id: 'tu_1', name: 'create_reminder', input: { title: 'Oil' } }]);
  });

  it('forces the record_events tool for extraction and returns its input', async () => {
    const { client, create } = fakeClient(message({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu_1', name: 'record_events', input: { events: [] }, caller: { type: 'direct' } } as Anthropic.ToolUseBlock],
    }));
    const out = await new ClaudeLlmProvider({ client, model: MODEL_SPECS.bedrock['claude-haiku-5-5'], label: 't' })
      .extractEvents('oil change 2024-01-01', { car: { make: 'VW', model: 'Golf' } });
    expect(out).toEqual({ events: [] });
    expect(paramsOf(create).tool_choice).toEqual({ type: 'tool', name: 'record_events' });
    expect(paramsOf(create).output_config).toEqual({ effort: 'medium' });
  });

  it('treats a refusal as empty output', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = fakeClient(message({ stop_reason: 'refusal', content: [] }));
    const out = await new ClaudeLlmProvider({ client, model: MODEL_SPECS.anthropic['claude-haiku-5-5'], label: 't' })
      .extractEvents('x', { car: { make: 'VW', model: 'Golf' } });
    expect(out).toBeNull();
  });

  it('turns any SDK failure into LlmUnavailableError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = fakeClient(new Error('boom'));
    await expect(new ClaudeLlmProvider({ client, model: MODEL_SPECS.anthropic['claude-haiku-5-5'], label: 't' })
      .chatTurn([{ role: 'user', content: 'hi' }], ctx, [], CHAT_TOOLS, 'auto')).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it('lets ping() surface the raw SDK error for the admin test', async () => {
    const err = new Error('invalid x-api-key');
    const { client } = fakeClient(err);
    await expect(new ClaudeLlmProvider({ client, model: MODEL_SPECS.anthropic['claude-haiku-4-5'], label: 't' }).ping()).rejects.toBe(err);
  });
});
