import { z } from 'zod';
import { WorkSchema, EventCategorySchema } from './event';
import { FuelTypeSchema } from './car';

export const SetSharingSchema = z.object({ shared: z.boolean() });

export const PublicProofSchema = z.object({
  url: z.string(), contentType: z.string(), filename: z.string().optional(),
});
export const PublicEventSchema = z.object({
  id: z.string(), date: z.string(), category: EventCategorySchema,
  mileage: z.number(), cost: z.number(), currency: z.string(),
  title: z.string().optional(), notes: z.string().optional(),
  works: z.array(WorkSchema), proofs: z.array(PublicProofSchema),
});
export const PublicCarSchema = z.object({
  id: z.string(), make: z.string(), model: z.string(), year: z.number(),
  nickname: z.string().optional(), fuelType: FuelTypeSchema, engineVolume: z.number().optional(),
  mileage: z.number(), vin: z.string().optional(), licensePlate: z.string().optional(),
  events: z.array(PublicEventSchema),
});

export type SetSharingInput = z.infer<typeof SetSharingSchema>;
export type PublicEvent = z.infer<typeof PublicEventSchema>;
export type PublicCar = z.infer<typeof PublicCarSchema>;