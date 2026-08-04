import { describe, expect, it, vi } from 'vitest';
import type { Car, Event, Reminder, ChatMessage, ChatAction } from '@carlog/contracts';
import type { LlmProvider, ChatTurnResult, ChatTurnEntry } from './llm-provider';
import type { ChatToolExecutor, ChatToolCall, ChatToolOutcome } from './chat-tools';
import { CHAT_TOOLS } from './chat-tools';
import {
  buildCarChatContext, chatAboutCar, ChatTurnInterruptedError, MAX_CONTEXT_EVENTS,
  MAX_MODEL_CALLS, TURN_BUDGET_MS, MIN_ROUND_BUDGET_MS,
} from './chat-about-car';

const car: Car = {
  id: 'car-1', ownerId: 'owner-secret', make: 'VW', model: 'Golf', year: 2018,
  mileage: 92000, fuelType: 'diesel', engineVolume: 2, nickname: 'Wolfie',
  vin: 'WVWZZZ1KZAW000001', licensePlate: 'AA1234BB',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', shared: false,
};

const events: Event[] = [
  {
    id: 'e1', carId: 'car-1', ownerId: 'owner-secret', date: '2023-06-01', category: 'oil_change',
    mileage: 70000, cost: 1200, currency: 'UAH', title: 'Oil', notes: undefined,
    works: [{ description: 'Oil & filter', parts: [{ name: '5W-30', quantity: 5 }] }],
    createdAt: '2023-06-01T00:00:00.000Z', updatedAt: '2023-06-01T00:00:00.000Z',
  },
  {
    id: 'e2', carId: 'car-1', ownerId: 'owner-secret', date: '2024-02-01', category: 'brakes',
    mileage: 84000, cost: 3000, currency: 'UAH', title: undefined, notes: undefined,
    works: [], createdAt: '2024-02-01T00:00:00.000Z', updatedAt: '2024-02-01T00:00:00.000Z',
  },
];

const reminders: Reminder[] = [
  {
    id: 'r1', carId: 'car-1', ownerId: 'owner-secret', title: 'Timing belt', category: 'repair',
    dueMileage: 120000, notes: undefined, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

describe('buildCarChatContext', () => {
  it('maps identity, timeline (newest first) and reminders', () => {
    const ctx = buildCarChatContext(car, events, reminders);
    expect(ctx.car.make).toBe('VW');
    expect(ctx.car.mileage).toBe(92000);
    expect(ctx.car.vin).toBe('WVWZZZ1KZAW000001');
    expect(ctx.events.map((e) => e.date)).toEqual(['2024-02-01', '2023-06-01']); // newest first
    expect(ctx.events[0]!.works).toEqual([]);
    expect(ctx.events[1]!.works[0]!.parts[0]!.name).toBe('5W-30');
    expect(ctx.reminders[0]!.dueMileage).toBe(120000);
  });

  it(`caps the timeline at ${MAX_CONTEXT_EVENTS} most-recent events`, () => {
    const many: Event[] = Array.from({ length: MAX_CONTEXT_EVENTS + 5 }, (_, i) => ({
      id: `e${i}`, carId: 'car-1', ownerId: 'owner-secret',
      // Ascending dates: e0 oldest … so the newest (highest index) must survive the cap.
      date: `20${String(10 + Math.floor(i / 12)).padStart(2, '0')}-${String((i % 12) + 1).padStart(2, '0')}-01`,
      category: 'other', mileage: 1000 + i, cost: 0, currency: 'UAH', title: `ev${i}`, notes: undefined,
      works: [], createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    }));
    const ctx = buildCarChatContext(car, many, []);
    expect(ctx.events).toHaveLength(MAX_CONTEXT_EVENTS);
    expect(ctx.events[0]!.title).toBe(`ev${MAX_CONTEXT_EVENTS + 4}`); // newest kept
    expect(ctx.events.some((e) => e.title === 'ev0')).toBe(false); // oldest dropped
  });

  it('never leaks owner identifiers or internal ids', () => {
    const ctx = buildCarChatContext(car, events, reminders);
    const json = JSON.stringify(ctx);
    expect(json).not.toContain('owner-secret');
    expect(json).not.toContain('car-1');
    expect(json).not.toContain('"id"');
    expect(json).not.toContain('ownerId');
  });
});

describe('chatAboutCar', () => {
  const ctx = buildCarChatContext(car, events, reminders);
  const userTurn: ChatMessage[] = [{ role: 'user', content: 'Remind me to change the oil' }];

  // A provider that replays a scripted ChatTurnResult per call and records the tools
  // it was offered on each round.
  const scripted = (rounds: ChatTurnResult[]) => {
    const offered: number[] = [];
    const llm: LlmProvider = {
      extractEvents: vi.fn(),
      extractEventsFromDocument: vi.fn(),
      chatTurn: vi.fn(async (_t, _c, _a, tools) => {
        offered.push(tools.length);
        const next = rounds.shift();
        if (!next) throw new Error('provider called more times than scripted');
        return next;
      }),
    };
    return { llm, offered };
  };

  const text = (t: string): ChatTurnResult => ({ text: t, toolCalls: [], raw: { t } });
  const call = (id: string, name: string): ChatTurnResult =>
    ({ text: '', toolCalls: [{ id, name, input: {} }], raw: { id } });

  const action: ChatAction = {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'create_reminder', status: 'done', summary: 'Oil change — 259500 km',
  };

  const executor = (outcome: ChatToolOutcome): ChatToolExecutor & { calls: ChatToolCall[] } => {
    const calls: ChatToolCall[] = [];
    return { calls, execute: async (c) => { calls.push(c); return outcome; } };
  };

  it('returns the reply from a single round with no tool calls', async () => {
    const { llm, offered } = scripted([text('You are due for oil soon.')]);
    const exec = executor({ content: 'x', isError: false });
    await expect(chatAboutCar(userTurn, llm, ctx, exec)).resolves.toEqual({
      reply: 'You are due for oil soon.', actions: [],
    });
    expect(exec.calls).toEqual([]);
    expect(offered).toEqual([CHAT_TOOLS.length]); // tools offered on the first round
  });

  it('executes a tool call, then returns the follow-up text and the action', async () => {
    const { llm } = scripted([call('t1', 'create_reminder'), text('Done — reminder created.')]);
    const exec = executor({ content: 'Created reminder', isError: false, action });
    const out = await chatAboutCar(userTurn, llm, ctx, exec);
    expect(out.reply).toBe('Done — reminder created.');
    expect(out.actions).toEqual([action]);
    expect(exec.calls.map((c) => c.name)).toEqual(['create_reminder']);
  });

  it('joins narration text from every round', async () => {
    const rounds: ChatTurnResult[] = [
      { text: 'Sure, creating that now.', toolCalls: [{ id: 't1', name: 'create_reminder', input: {} }], raw: {} },
      text('Created.'),
    ];
    const { llm } = scripted(rounds);
    const out = await chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false }));
    expect(out.reply).toBe('Sure, creating that now.\n\nCreated.');
  });

  it('sends all results of one round back as a single tool_results entry', async () => {
    const two: ChatTurnResult = {
      text: '', raw: {},
      toolCalls: [
        { id: 't1', name: 'create_reminder', input: {} },
        { id: 't2', name: 'create_reminder', input: {} },
      ],
    };
    const { llm } = scripted([two, text('Both done.')]);
    await chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false }));
    const secondCallTranscript = vi.mocked(llm.chatTurn).mock.calls[1]![0];
    const isResults = (e: ChatTurnEntry): e is Extract<ChatTurnEntry, { role: 'tool_results' }> =>
      e.role === 'tool_results';
    const resultEntries = secondCallTranscript.filter(isResults);
    expect(resultEntries).toHaveLength(1);
    expect(resultEntries[0]!.results).toHaveLength(2);
  });

  it('echoes the provider raw assistant content back unchanged', async () => {
    const raw = { blocks: ['thinking-sentinel'] };
    const { llm } = scripted([
      { text: '', toolCalls: [{ id: 't1', name: 'create_reminder', input: {} }], raw },
      text('ok'),
    ]);
    await chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false }));
    const secondCallTranscript = vi.mocked(llm.chatTurn).mock.calls[1]![0];
    expect(secondCallTranscript).toContainEqual({ role: 'assistant', raw });
  });

  it('stops offering tools on the last permitted model call', async () => {
    const keepCalling = () => call('t', 'create_reminder');
    const { llm, offered } = scripted([keepCalling(), keepCalling(), text('Final answer.')]);
    const out = await chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false }));
    expect(out.reply).toBe('Final answer.');
    expect(llm.chatTurn).toHaveBeenCalledTimes(MAX_MODEL_CALLS);
    expect(offered).toEqual([CHAT_TOOLS.length, CHAT_TOOLS.length, 0]); // forced text last
  });

  it('forces the final text round early when the clock budget runs low', async () => {
    // now() is read once for startedAt, then once per round. Round 0 has the full budget;
    // by round 1 only TURN_BUDGET_MS - 20000 = 6s remains, under MIN_ROUND_BUDGET_MS.
    const clock = [0, 0, 20_000];
    expect(TURN_BUDGET_MS - 20_000).toBeLessThan(MIN_ROUND_BUDGET_MS);
    const now = () => clock.shift() ?? 20_000;
    const { llm, offered } = scripted([call('t1', 'create_reminder'), text('Ran out of time, here is what I know.')]);
    const out = await chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false }), [], { now });
    expect(out.reply).toBe('Ran out of time, here is what I know.');
    expect(offered).toEqual([CHAT_TOOLS.length, 0]); // second round had no tools
  });

  it('sends attachments on the first round only', async () => {
    const { llm } = scripted([call('t1', 'create_reminder'), text('ok')]);
    const attachments = [{ base64: 'AAA', mediaType: 'image/png' }];
    await chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false }), attachments);
    expect(vi.mocked(llm.chatTurn).mock.calls[0]![2]).toEqual(attachments);
    expect(vi.mocked(llm.chatTurn).mock.calls[1]![2]).toEqual([]);
  });

  it('keeps a failed tool from failing the turn', async () => {
    const { llm } = scripted([call('t1', 'create_reminder'), text('That did not work.')]);
    const exec: ChatToolExecutor = { execute: async () => ({ content: 'Invalid input', isError: true }) };
    const out = await chatAboutCar(userTurn, llm, ctx, exec);
    expect(out.reply).toBe('That did not work.');
    expect(out.actions).toEqual([]);
  });

  it('reports committed actions when a later round fails, instead of losing them', async () => {
    const boom = new Error('bedrock exploded');
    const llm: LlmProvider = {
      extractEvents: vi.fn(),
      extractEventsFromDocument: vi.fn(),
      chatTurn: vi.fn()
        .mockResolvedValueOnce(call('t1', 'create_reminder'))
        .mockRejectedValueOnce(boom),
    };
    const err = await chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false, action }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChatTurnInterruptedError);
    expect((err as ChatTurnInterruptedError).actions).toEqual([action]);
    expect((err as ChatTurnInterruptedError).cause).toBe(boom);
  });

  it('lets a first-round failure surface unchanged (nothing was committed)', async () => {
    const boom = new Error('bedrock exploded');
    const llm: LlmProvider = {
      extractEvents: vi.fn(),
      extractEventsFromDocument: vi.fn(),
      chatTurn: vi.fn(async () => { throw boom; }),
    };
    await expect(chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false })))
      .rejects.toBe(boom);
  });

  it('falls back to an action summary when the model produced no text', async () => {
    const { llm } = scripted([call('t1', 'create_reminder'), text('')]);
    const out = await chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false, action }));
    expect(out.reply).toContain('Oil change — 259500 km');
    expect(out.actions).toEqual([action]);
  });

  it('rejects an empty history', async () => {
    const { llm } = scripted([text('x')]);
    await expect(chatAboutCar([], llm, ctx, executor({ content: 'ok', isError: false }))).rejects.toThrow();
  });

  it('rejects a history not ending in a user turn', async () => {
    const { llm } = scripted([text('x')]);
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    await expect(chatAboutCar(messages, llm, ctx, executor({ content: 'ok', isError: false }))).rejects.toThrow();
  });
});
