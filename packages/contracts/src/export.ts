import { z } from 'zod';
import { CreateCarSchema } from './car';
import { CreateEventSchema } from './event';
import { CreateReminderSchema, MAX_REMINDERS_PER_CAR } from './reminder';
import { MAX_JOB_EVENTS } from './import';

export const CAR_EXPORT_FORMAT = 'carlog-car';
export const CAR_EXPORT_VERSION = 1;

// The portable service book: one car's profile + timeline + reminders, as the CREATE
// shapes — server-owned fields (ids, ownerId, timestamps, shared) are deliberately
// absent; the import re-mints them. `version` is a literal so a future v2 widens it
// to a union and old apps reject newer files instead of mis-reading them.
export const CarExportSchema = z.object({
  format: z.literal(CAR_EXPORT_FORMAT),
  version: z.literal(CAR_EXPORT_VERSION),
  exportedAt: z.string().datetime(),
  // Explicit marker so a future version can carry attachment payloads.
  attachments: z.literal('not-included'),
  car: CreateCarSchema,
  events: z.array(CreateEventSchema).max(MAX_JOB_EVENTS),
  reminders: z.array(CreateReminderSchema).max(MAX_REMINDERS_PER_CAR),
});

export type CarExport = z.infer<typeof CarExportSchema>;
