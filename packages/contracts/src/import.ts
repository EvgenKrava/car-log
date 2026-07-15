import { z } from 'zod';
import { CreateEventSchema } from './event';

// A CandidateEvent is an Event the user has NOT committed yet. Its OUTPUT shape equals
// the body the existing `POST /cars/{id}/events` route accepts (CreateEventSchema), so a
// reviewed candidate is POSTed verbatim with no field remapping. Its INPUT is lenient:
// pasted notes are often partial, so fields the model omits get safe defaults instead of
// the whole event being dropped — missing mileage/cost become 0 and a missing date
// becomes today, all visible and editable in the review dialog before commit.
export const CandidateEventSchema = CreateEventSchema.extend({
  date: CreateEventSchema.shape.date.default(() => new Date().toISOString().slice(0, 10)),
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
