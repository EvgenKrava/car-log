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
  it('accepts a partial candidate (category only) with safe defaults', () => {
    const parsed = CandidateEventSchema.parse({ category: 'repair' });
    expect(parsed.mileage).toBe(0);
    expect(parsed.cost).toBe(0);
    expect(parsed.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The defaulted output is committable via the create route (which requires these fields).
    expect(parsed).toMatchObject({ category: 'repair', currency: 'UAH', works: [] });
  });
  it('still rejects a candidate with no category', () => {
    expect(CandidateEventSchema.safeParse({ date: '2024-01-15' }).success).toBe(false);
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
