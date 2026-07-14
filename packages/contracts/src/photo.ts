import { z } from 'zod';

export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export const MAX_PHOTO_SIZE = 10_485_760; // 10 MB
export const MAX_PHOTOS_PER_CAR = 20;

export const PhotoContentTypeSchema = z.enum(ALLOWED_PHOTO_TYPES);

export const PresignRequestSchema = z.object({
  contentType: PhotoContentTypeSchema,
  size: z.number().int().min(1).max(MAX_PHOTO_SIZE),
});

export const PhotoSchema = z.object({
  id: z.string().uuid(),
  carId: z.string().uuid(),
  ownerId: z.string().min(1),
  contentType: PhotoContentTypeSchema,
  size: z.number().int().min(1).max(MAX_PHOTO_SIZE),
  createdAt: z.string().datetime(),
});

export const PresignResponseSchema = z.object({
  photoId: z.string().uuid(),
  uploadUrl: z.string().url(),
  key: z.string().min(1),
});

export const PhotoWithUrlSchema = PhotoSchema.extend({ url: z.string().url() });

export type PhotoContentType = z.infer<typeof PhotoContentTypeSchema>;
export type PresignRequest = z.infer<typeof PresignRequestSchema>;
export type Photo = z.infer<typeof PhotoSchema>;
export type PresignResponse = z.infer<typeof PresignResponseSchema>;
export type PhotoWithUrl = z.infer<typeof PhotoWithUrlSchema>;
