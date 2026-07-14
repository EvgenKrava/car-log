import { describe, expect, it } from 'vitest';
import { eventSk, proofSk, proofKey, isEventRow, assertProofUnderCap } from './event-key';
import { CapExceededError } from '@carlog/domain';
import { MAX_PROOFS_PER_EVENT } from '@carlog/contracts';

describe('keys', () => {
  it('builds event and proof SKs and the proof S3 key', () => {
    expect(eventSk('c1', 'e1')).toBe('CAR#c1#EVENT#e1');
    expect(proofSk('c1', 'e1', 'p1')).toBe('CAR#c1#EVENT#e1#PROOF#p1');
    expect(proofKey('u1', 'c1', 'e1', 'p1')).toBe('proofs/u1/c1/e1/p1');
  });
});

describe('isEventRow (collision guard)', () => {
  it('is true for an event SK', () => { expect(isEventRow('CAR#c1#EVENT#e1')).toBe(true); });
  it('is false for a proof SK under an event', () => { expect(isEventRow('CAR#c1#EVENT#e1#PROOF#p1')).toBe(false); });
});

describe('assertProofUnderCap', () => {
  it('allows under the cap', () => { expect(() => assertProofUnderCap(MAX_PROOFS_PER_EVENT - 1)).not.toThrow(); });
  it('throws at the cap', () => { expect(() => assertProofUnderCap(MAX_PROOFS_PER_EVENT)).toThrow(CapExceededError); });
});
