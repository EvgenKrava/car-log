import { describe, expect, it } from 'vitest';
import { ExtractEventsRequestSchema, ExtractEventsResponseSchema, CandidateEventSchema } from './import';

describe('ExtractEventsRequestSchema', () => {
  it('accepts non-empty text under 10k chars', () => {
    expect(ExtractEventsRequestSchema.parse({ text: 'oil change at 45000km' })).toEqual({ text: 'oil change at 45000km' });
  });
  it('rejects empty text', () => {
    expect(ExtractEventsRequestSchema.safeParse({ text: '' }).success).toBe(false);
  });
  it('rejects text over 10k chars', () => {
    expect(ExtractEventsRequestSchema.safeParse({ text: 'a'.repeat(10_001) }).success).toBe(false);
  });
});

describe('CandidateEventSchema', () => {
  it('equals the create-event body: parses a full candidate and defaults works/currency', () => {
    const parsed = CandidateEventSchema.parse({ date: '2024-01-15', mileage: 45000, cost: 1200, category: 'oil_change' });
    expect(parsed).toMatchObject({ category: 'oil_change', currency: 'UAH', works: [] });
  });
});

describe('ExtractEventsResponseSchema', () => {
  it('accepts a list of candidate events', () => {
    const r = ExtractEventsResponseSchema.parse({ events: [{ date: '2024-01-15', mileage: 45000, cost: 1200, category: 'oil_change' }] });
    expect(r.events).toHaveLength(1);
  });
  it('rejects more than 50 events', () => {
    const one = { date: '2024-01-15', mileage: 1, cost: 1, category: 'other' };
    expect(ExtractEventsResponseSchema.safeParse({ events: Array.from({ length: 51 }, () => one) }).success).toBe(false);
  });
});
