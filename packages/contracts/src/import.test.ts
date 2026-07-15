import { describe, expect, it } from 'vitest';
import { ExtractEventsRequestSchema, ExtractEventsResponseSchema, CandidateEventSchema, CreateImportJobRequestSchema, ImportJobSchema, ImportJobStatusSchema, IMPORT_INLINE_MAX, ScanPresignRequestSchema, ExtractFromScanRequestSchema, FromScanProofSchema, MAX_SCAN_SIZE } from './import';

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

describe('CreateImportJobRequestSchema', () => {
  const carId = '3f1e9d5a-6b2c-4e8f-9a1b-2c3d4e5f6a7b';
  it('accepts inline text', () => {
    expect(CreateImportJobRequestSchema.safeParse({ carId, text: 'oil change' }).success).toBe(true);
  });
  it('accepts an s3Key', () => {
    expect(CreateImportJobRequestSchema.safeParse({ carId, s3Key: 'imports/u/x.txt' }).success).toBe(true);
  });
  it('rejects both text and s3Key', () => {
    expect(CreateImportJobRequestSchema.safeParse({ carId, text: 'x', s3Key: 'k' }).success).toBe(false);
  });
  it('rejects neither', () => {
    expect(CreateImportJobRequestSchema.safeParse({ carId }).success).toBe(false);
  });
  it('rejects text over the inline cap', () => {
    expect(CreateImportJobRequestSchema.safeParse({ carId, text: 'a'.repeat(IMPORT_INLINE_MAX + 1) }).success).toBe(false);
  });
});

describe('ImportJobSchema', () => {
  it('parses a fresh job with defaults', () => {
    const job = ImportJobSchema.parse({
      id: '3f1e9d5a-6b2c-4e8f-9a1b-2c3d4e5f6a7b',
      carId: '3f1e9d5a-6b2c-4e8f-9a1b-2c3d4e5f6a7c',
      status: 'pending',
      progress: { done: 0, total: 0, found: 0 },
      createdAt: '2026-07-15T10:00:00.000Z',
    });
    expect(job.events).toEqual([]);
    expect(job.skippedChunks).toBe(0);
  });
  it('rejects an unknown status', () => {
    expect(ImportJobStatusSchema.safeParse('paused').success).toBe(false);
  });
});

describe('scan schemas', () => {
  const carId = '3f1e9d5a-6b2c-4e8f-9a1b-2c3d4e5f6a7b';
  it('accepts a jpeg presign under the cap', () => {
    expect(ScanPresignRequestSchema.safeParse({ contentType: 'image/jpeg', size: 1000 }).success).toBe(true);
  });
  it('accepts a pdf', () => {
    expect(ScanPresignRequestSchema.safeParse({ contentType: 'application/pdf', size: 1000 }).success).toBe(true);
  });
  it('rejects an unsupported content type (heic excluded — Claude vision cannot read it)', () => {
    expect(ScanPresignRequestSchema.safeParse({ contentType: 'image/gif', size: 1000 }).success).toBe(false);
    expect(ScanPresignRequestSchema.safeParse({ contentType: 'image/heic', size: 1000 }).success).toBe(false);
  });
  it('rejects over the size cap', () => {
    expect(ScanPresignRequestSchema.safeParse({ contentType: 'image/png', size: MAX_SCAN_SIZE + 1 }).success).toBe(false);
  });
  it('caps images at 5 MB but allows PDFs up to 10 MB', () => {
    const sixMB = 6_291_456;
    expect(ScanPresignRequestSchema.safeParse({ contentType: 'image/jpeg', size: sixMB }).success).toBe(false);
    expect(ScanPresignRequestSchema.safeParse({ contentType: 'application/pdf', size: sixMB }).success).toBe(true);
  });
  it('validates an extract-from-scan request', () => {
    expect(ExtractFromScanRequestSchema.safeParse({ carId, s3Key: 'scans/u/x.jpg', contentType: 'image/jpeg' }).success).toBe(true);
  });
  it('validates a from-scan proof request', () => {
    expect(FromScanProofSchema.safeParse({ s3Key: 'scans/u/x.jpg', contentType: 'image/jpeg', size: 5000 }).success).toBe(true);
  });
});
