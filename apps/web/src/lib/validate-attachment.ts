import { ATTACHMENT_CONTENT_TYPES, MAX_PROOF_SIZE, MAX_PROOFS_PER_EVENT } from '@carlog/contracts';

const isAllowed = (t: string): boolean => (ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(t);

export function validateAttachmentFile(
  file: { type: string; size: number }, currentCount: number,
): { key: string; params?: Record<string, unknown> } | null {
  if (currentCount >= MAX_PROOFS_PER_EVENT) return { key: 'event:proofTooMany', params: { max: MAX_PROOFS_PER_EVENT } };
  if (!isAllowed(file.type)) return { key: 'event:proofBadType' };
  if (file.size > MAX_PROOF_SIZE) return { key: 'event:proofTooLarge' };
  if (file.size < 1) return { key: 'event:proofEmpty' };
  return null;
}
