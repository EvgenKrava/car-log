import { describe, expect, it, vi } from 'vitest';
import { extractEvents, extractEventsFromDocument, ExtractionFailedError } from './extract-events';
import type { LlmProvider, ExtractionContext } from './llm-provider';

const ctx: ExtractionContext = { car: { make: 'Toyota', model: 'Corolla', year: 2020 } };
const valid = { date: '2024-01-15', mileage: 45000, cost: 1200, category: 'oil_change' };

const providerReturning = (...outputs: unknown[]): LlmProvider => {
  const fn = vi.fn();
  outputs.forEach((o) => fn.mockResolvedValueOnce(o));
  return { extractEvents: fn, extractEventsFromDocument: vi.fn() };
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

  it('keeps partial items (category only): mileage undefined, cost 0, date blank', async () => {
    const out = await extractEvents('text', providerReturning({ events: [{ category: 'repair' }] }), ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ category: 'repair', cost: 0 });
    expect(out[0]?.mileage).toBeUndefined();
    expect(out[0]?.date).toBe('');
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

const docProvider = (...outputs: unknown[]): LlmProvider => {
  const fn = vi.fn();
  outputs.forEach((o) => fn.mockResolvedValueOnce(o));
  // extractEvents unused in these tests but required by the interface
  return { extractEvents: vi.fn(), extractEventsFromDocument: fn };
};

describe('extractEventsFromDocument', () => {
  it('returns multiple candidates from one document', async () => {
    const out = await extractEventsFromDocument('BASE64', 'image/jpeg', docProvider({ events: [valid, { ...valid, category: 'repair' }] }), ctx);
    expect(out).toHaveLength(2);
  });
  it('returns [] when the document is unreadable (no events)', async () => {
    const out = await extractEventsFromDocument('BASE64', 'application/pdf', docProvider({ events: [] }), ctx);
    expect(out).toEqual([]);
  });
  it('drops malformed items', async () => {
    const out = await extractEventsFromDocument('BASE64', 'image/png', docProvider({ events: [valid, { junk: 1 }] }), ctx);
    expect(out).toHaveLength(1);
  });
  it('retries once on shapeless then throws ExtractionFailedError', async () => {
    const p = docProvider('garbage', 'still garbage');
    await expect(extractEventsFromDocument('B', 'image/jpeg', p, ctx)).rejects.toBeInstanceOf(ExtractionFailedError);
    expect(p.extractEventsFromDocument).toHaveBeenCalledTimes(2);
  });
});
