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
