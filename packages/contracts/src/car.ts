import { z } from 'zod';

export const FuelTypeSchema = z.enum(['petrol', 'diesel', 'electric', 'hybrid', 'lpg', 'other']);

const emptyToUndefined = (s: z.ZodString) =>
  z.preprocess((v) => (v === '' ? undefined : v), s.optional());

export const CreateCarSchema = z.object({
  make: z.string().min(1).max(60),
  model: z.string().min(1).max(60),
  year: z.number().int().min(1900).max(2027),
  mileage: z.number().int().min(0),
  fuelType: FuelTypeSchema,
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

export const UpdateCarSchema = CreateCarSchema.partial();

export type FuelType = z.infer<typeof FuelTypeSchema>;
export type CreateCarInput = z.infer<typeof CreateCarSchema>;
export type UpdateCarInput = z.infer<typeof UpdateCarSchema>;

// Explicit type for Car to work around Zod preprocess inference limitation
export type Car = {
  make: string;
  model: string;
  year: number;
  mileage: number;
  fuelType: FuelType;
  nickname?: string;
  vin?: string;
  licensePlate?: string;
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};
