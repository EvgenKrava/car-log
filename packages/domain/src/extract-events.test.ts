import { describe, expect, it, vi } from 'vitest';
import { extractEvents, ExtractionFailedError } from './extract-events';
import type { LlmProvider, ExtractionContext } from './llm-provider';

const ctx: ExtractionContext = { car: { make: 'Toyota', model: 'Corolla', year: 2020 } };
const valid = { date: '2024-01-15', mileage: 45000, cost: 1200, category: 'oil_change' };

const providerReturning = (...outputs: unknown[]): LlmProvider => {
  const fn = vi.fn();
  outputs.forEach((o) => fn.mockResolvedValueOnce(o));
  return { extractEvents: fn };
};

describe('extractEvents', () => {
  it('returns validated candidates from { events: [...] }', async () => {
    const out = await extractEvents('text', providerReturning({ events: [valid] }), ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ category: 'oil_change', currency: 'UAH', works: [] });
  });

  it('accepts a bare array output', async () => {
    const out = await extractEvents('text', providerReturning([valid, valid]), ctx);
    expect(out).toHaveLength(2);
  });

  it('drops malformed items but keeps valid ones', async () => {
    const out = await extractEvents('text', providerReturning({ events: [valid, { junk: true }] }), ctx);
    expect(out).toHaveLength(1);
  });

  it('keeps partial items (category only), filling safe defaults', async () => {
    const out = await extractEvents('text', providerReturning({ events: [{ category: 'repair' }] }), ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ category: 'repair', mileage: 0, cost: 0 });
    expect(out[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns [] when the model finds no events (valid empty array)', async () => {
    const out = await extractEvents('text', providerReturning({ events: [] }), ctx);
    expect(out).toEqual([]);
  });

  it('retries once on a shapeless first response, then succeeds', async () => {
    const provider = providerReturning('not json at all', { events: [valid] });
    const out = await extractEvents('text', provider, ctx);
    expect(out).toHaveLength(1);
    expect(provider.extractEvents).toHaveBeenCalledTimes(2);
  });

  it('throws ExtractionFailedError when both attempts are shapeless', async () => {
    const provider = providerReturning('garbage', 'still garbage');
    await expect(extractEvents('text', provider, ctx)).rejects.toBeInstanceOf(ExtractionFailedError);
    expect(provider.extractEvents).toHaveBeenCalledTimes(2);
  });

  it('caps output at 50 events', async () => {
    const many = Array.from({ length: 60 }, () => valid);
    const out = await extractEvents('text', providerReturning({ events: many }), ctx);
    expect(out).toHaveLength(50);
  });
});
