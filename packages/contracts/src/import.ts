import { z } from 'zod';
import { CreateEventSchema } from './event';

// A CandidateEvent is an Event the user has NOT committed yet. Extraction is lenient:
// partial notes/documents are common, so fields the model omits get safe placeholders
// instead of the whole event being dropped. Missing mileage/cost become 0; a missing date
// becomes an EMPTY STRING (never today) — the review dialog surfaces the blank date as a
// required field the user must fill before commit. When committing, the empty date is
// replaced by the user's input, so what reaches the create route is a valid CreateEvent.
export const CandidateEventSchema = CreateEventSchema.extend({
  date: CreateEventSchema.shape.date.or(z.literal('')).default(''),
  mileage: CreateEventSchema.shape.mileage.default(0),
  cost: CreateEventSchema.shape.cost.default(0),
});
export type CandidateEvent = z.infer<typeof CandidateEventSchema>;

export const ExtractEventsRequestSchema = z.object({
  text: z.string().min(1).max(10_000),
});
export type ExtractEventsRequest = z.infer<typeof ExtractEventsRequestSchema>;

export const ExtractEventsResponseSchema = z.object({
  events: z.array(CandidateEventSchema).max(50),
});
export type ExtractEventsResponse = z.infer<typeof ExtractEventsResponseSchema>;

export const IMPORT_INLINE_MAX = 64_000;
export const IMPORT_FILE_MAX = 1_048_576;
export const MAX_JOB_EVENTS = 500;
export const IMPORT_CHUNK_SIZE = 10_000;

export const CreateImportJobRequestSchema = z.object({
  carId: z.string().uuid(),
  text: z.string().min(1).max(IMPORT_INLINE_MAX).optional(),
  s3Key: z.string().min(1).optional(),
}).refine((v) => Boolean(v.text) !== Boolean(v.s3Key), { message: 'exactly one of text or s3Key' });
export type CreateImportJobRequest = z.infer<typeof CreateImportJobRequestSchema>;

export const ImportJobStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);
export type ImportJobStatus = z.infer<typeof ImportJobStatusSchema>;

export const ImportJobSchema = z.object({
  id: z.string().uuid(),
  carId: z.string().uuid(),
  status: ImportJobStatusSchema,
  progress: z.object({
    done: z.number().int().min(0),
    total: z.number().int().min(0),
    found: z.number().int().min(0),
  }),
  events: z.array(CandidateEventSchema).max(MAX_JOB_EVENTS).default([]),
  skippedChunks: z.number().int().min(0).default(0),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type ImportJob = z.infer<typeof ImportJobSchema>;

export const ImportTxtPresignRequestSchema = z.object({
  size: z.number().int().min(1).max(IMPORT_FILE_MAX),
});
export type ImportTxtPresignRequest = z.infer<typeof ImportTxtPresignRequestSchema>;

// HEIC is intentionally excluded: Claude vision cannot decode HEIC image blocks, so a
// HEIC scan would always fail server-side. PDFs and the three web-decodable image types only.
export const SCAN_DOC_CONTENT_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
] as const;
export const ScanDocContentTypeSchema = z.enum(SCAN_DOC_CONTENT_TYPES);
export type ScanDocContentType = z.infer<typeof ScanDocContentTypeSchema>;
// PDFs may be up to 10 MB; images are capped lower because Claude vision rejects images
// over ~5 MB (base64) — a larger image would upload fine then fail opaquely at the model.
export const MAX_SCAN_SIZE = 10_485_760;
export const MAX_SCAN_IMAGE_SIZE = 5_242_880;

// Per-content-type size ceiling for a scan upload.
export function maxScanSize(contentType: string): number {
  return contentType === 'application/pdf' ? MAX_SCAN_SIZE : MAX_SCAN_IMAGE_SIZE;
}

export const ScanPresignRequestSchema = z.object({
  contentType: ScanDocContentTypeSchema,
  size: z.number().int().min(1).max(MAX_SCAN_SIZE),
}).refine((v) => v.size <= maxScanSize(v.contentType), { message: 'file too large for its type', path: ['size'] });
export type ScanPresignRequest = z.infer<typeof ScanPresignRequestSchema>;

export const ScanPresignResponseSchema = z.object({
  key: z.string().min(1), uploadUrl: z.string().url(),
});

export const ExtractFromScanRequestSchema = z.object({
  carId: z.string().uuid(),
  s3Key: z.string().min(1),
  contentType: ScanDocContentTypeSchema,
});
export type ExtractFromScanRequest = z.infer<typeof ExtractFromScanRequestSchema>;

export const FromScanProofSchema = z.object({
  s3Key: z.string().min(1),
  contentType: ScanDocContentTypeSchema,
  // The client holds the picked File, so it sends the byte size — the Proof row requires
  // size >= 1 and the server-side CopyObject doesn't re-measure it.
  size: z.number().int().min(1).max(MAX_SCAN_SIZE),
}).refine((v) => v.size <= maxScanSize(v.contentType), { message: 'file too large for its type', path: ['size'] });
export type FromScanProof = z.infer<typeof FromScanProofSchema>;
