import { z } from 'zod';
import { CreateEventSchema } from './event';

// A CandidateEvent is an Event the user has NOT committed yet: exactly the body the
// existing `POST /cars/{id}/events` route accepts (CreateEventSchema), so a reviewed
// candidate is POSTed verbatim with no field remapping.
export const CandidateEventSchema = CreateEventSchema;
export type CandidateEvent = z.infer<typeof CandidateEventSchema>;

export const ExtractEventsRequestSchema = z.object({
  text: z.string().min(1).max(10_000),
});
export type ExtractEventsRequest = z.infer<typeof ExtractEventsRequestSchema>;

export const ExtractEventsResponseSchema = z.object({
  events: z.array(CandidateEventSchema).max(50),
});
export type ExtractEventsResponse = z.infer<typeof ExtractEventsResponseSchema>;
