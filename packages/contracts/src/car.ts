import { z } from 'zod';

export const FuelTypeSchema = z.enum(['petrol', 'diesel', 'electric', 'hybrid', 'lpg', 'other']);

// Treat an empty string as "not provided": match '' first (→ undefined),
// otherwise validate with the given string schema. Output type is `string | undefined`.
const emptyToUndefined = (s: z.ZodString) =>
  z
    .literal('')
    .transform(() => undefined)
    .or(s.optional());

export const CreateCarSchema = z.object({
  make: z.string().min(1).max(60),
  model: z.string().min(1).max(60),
  year: z.number().int().min(1900).max(2027),
  mileage: z.number().int().min(0),
  fuelType: FuelTypeSchema,
  // Displacement in liters (e.g. 1.6, 2.0). 20L ceiling covers trucks; EVs leave it unset.
  engineVolume: z.number().positive().max(20).optional(),
  nickname: emptyToUndefined(z.string().max(60)),
  vin: emptyToUndefined(z.string().regex(/^[A-HJ-NPR-Z0-9]{11,17}$/i, 'invalid VIN')),
  licensePlate: emptyToUndefined(z.string().max(15)),
});

export const CarSchema = CreateCarSchema.extend({
  id: z.string().uuid(),
  ownerId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type FuelType = z.infer<typeof FuelTypeSchema>;
export type Car = z.infer<typeof CarSchema>;
export type CreateCarInput = z.infer<typeof CreateCarSchema>;
