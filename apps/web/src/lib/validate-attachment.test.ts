import { describe, expect, it } from 'vitest';
import { validateAttachmentFile } from './validate-attachment';
import { MAX_PROOF_SIZE, MAX_PROOFS_PER_EVENT } from '@carlog/contracts';

describe('validateAttachmentFile', () => {
  it('accepts a jpeg', () => { expect(validateAttachmentFile({ type: 'image/jpeg', size: 1024 }, 0)).toBeNull(); });
  it('accepts a pdf', () => { expect(validateAttachmentFile({ type: 'application/pdf', size: 1024 }, 0)).toBeNull(); });
  it('rejects an unsupported type', () => { expect(validateAttachmentFile({ type: 'text/plain', size: 10 }, 0)?.key).toBe('event:proofBadType'); });
  it('rejects oversize', () => { expect(validateAttachmentFile({ type: 'application/pdf', size: MAX_PROOF_SIZE + 1 }, 0)?.key).toBe('event:proofTooLarge'); });
  it('rejects at cap', () => { expect(validateAttachmentFile({ type: 'application/pdf', size: 10 }, MAX_PROOFS_PER_EVENT)?.key).toBe('event:proofTooMany'); });
});
