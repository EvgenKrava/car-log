import { z } from 'zod';

// A browser-side S3 POST: multipart form with every `fields` entry, then the file last.
export const PresignedUploadSchema = z.object({
  url: z.string().url(),
  fields: z.record(z.string()),
});
export type PresignedUpload = z.infer<typeof PresignedUploadSchema>;
