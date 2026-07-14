import { z } from 'zod';

export const ATTACHMENT_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'] as const;
export const MAX_PROOF_SIZE = 10_485_760; // 10 MB
export const MAX_PROOFS_PER_EVENT = 20;

export const AttachmentContentTypeSchema = z.enum(ATTACHMENT_CONTENT_TYPES);

export const ProofPresignRequestSchema = z.object({
  contentType: AttachmentContentTypeSchema,
  size: z.number().int().min(1).max(MAX_PROOF_SIZE),
  filename: z.string().min(1).max(200).optional(),
});

export const ProofSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  carId: z.string().uuid(),
  ownerId: z.string().min(1),
  contentType: AttachmentContentTypeSchema,
  size: z.number().int().min(1).max(MAX_PROOF_SIZE),
  filename: z.string().max(200).optional(),
  createdAt: z.string().datetime(),
});

export const ProofConfirmSchema = ProofPresignRequestSchema.extend({ proofId: z.string().uuid() });
export const ProofPresignResponseSchema = z.object({ proofId: z.string().uuid(), uploadUrl: z.string().url(), key: z.string().min(1) });
export const ProofWithUrlSchema = ProofSchema.extend({ url: z.string().url() });

export type AttachmentContentType = z.infer<typeof AttachmentContentTypeSchema>;
export type ProofPresignRequest = z.infer<typeof ProofPresignRequestSchema>;
export type Proof = z.infer<typeof ProofSchema>;
export type ProofConfirm = z.infer<typeof ProofConfirmSchema>;
export type ProofPresignResponse = z.infer<typeof ProofPresignResponseSchema>;
export type ProofWithUrl = z.infer<typeof ProofWithUrlSchema>;
