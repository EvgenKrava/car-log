import { z } from 'zod';

export const EVENT_CATEGORIES = ['oil_change', 'tires', 'brakes', 'inspection', 'repair', 'other'] as const;
export const MAX_WORKS_PER_EVENT = 30;
export const MAX_PARTS_PER_WORK = 30;

// Optional free-text/url fields: the form submits '' for empty inputs; match '' first
// (→ undefined) so an empty purchaseLink doesn't fail the .url() check. Same pattern as
// the car contracts' emptyToUndefined (learned from the blank-VIN bug).
const optText = (s: z.ZodString) => z.literal('').transform(() => undefined).or(s.optional());

export const PartUsageSchema = z.object({
  name: z.string().min(1).max(80),
  brand: optText(z.string().max(60)),
  partNumber: optText(z.string().max(60)),
  quantity: z.number().int().min(1),
  notes: optText(z.string().max(500)),
  purchaseLink: optText(z.string().url().max(500)),
});

export const WorkSchema = z.object({
  description: z.string().min(1).max(200),
  parts: z.array(PartUsageSchema).max(MAX_PARTS_PER_WORK).default([]),
});

export const EventCategorySchema = z.enum(EVENT_CATEGORIES);

export const CreateEventSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  mileage: z.number().int().min(0),
  cost: z.number().min(0),
  currency: z.string().min(1).max(8).default('UAH'),
  category: EventCategorySchema,
  title: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  works: z.array(WorkSchema).max(MAX_WORKS_PER_EVENT).default([]),
});

export const EventSchema = CreateEventSchema.extend({
  id: z.string().uuid(),
  carId: z.string().uuid(),
  ownerId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PartUsage = z.infer<typeof PartUsageSchema>;
export type Work = z.infer<typeof WorkSchema>;
export type EventCategory = z.infer<typeof EventCategorySchema>;
export type Event = z.infer<typeof EventSchema>;
export type CreateEventInput = z.infer<typeof CreateEventSchema>;
