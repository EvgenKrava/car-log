import { describe, expect, it, vi } from 'vitest';
import type { Car, Event, Reminder, ChatMessage } from '@carlog/contracts';
import type { LlmProvider } from './llm-provider';
import { buildCarChatContext, chatAboutCar, MAX_CONTEXT_EVENTS } from './chat-about-car';

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
  const provider = (reply: string): LlmProvider => ({
    extractEvents: vi.fn(),
    extractEventsFromDocument: vi.fn(),
    chat: vi.fn(async () => reply),
  });

  it('delegates to the provider and returns its reply', async () => {
    const llm = provider('You are due for oil soon.');
    const messages: ChatMessage[] = [{ role: 'user', content: 'When is my next oil change?' }];
    await expect(chatAboutCar(messages, llm, ctx)).resolves.toBe('You are due for oil soon.');
    expect(llm.chat).toHaveBeenCalledWith(messages, ctx);
  });

  it('rejects an empty history', async () => {
    await expect(chatAboutCar([], provider('x'), ctx)).rejects.toThrow();
  });

  it('rejects a history not ending in a user turn', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    await expect(chatAboutCar(messages, provider('x'), ctx)).rejects.toThrow();
  });
});