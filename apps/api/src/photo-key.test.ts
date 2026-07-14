import { describe, expect, it } from 'vitest';
import { photoKey, assertUnderCap } from './photo-key';
import { CapExceededError } from '@carlog/domain';
import { MAX_PHOTOS_PER_CAR } from '@carlog/contracts';

describe('photoKey', () => {
  it('builds an owner/car-scoped key', () => {
    expect(photoKey('u1', 'c1', 'p1')).toBe('photos/u1/c1/p1');
  });
});

describe('assertUnderCap', () => {
  it('allows a count under the cap', () => {
    expect(() => assertUnderCap(MAX_PHOTOS_PER_CAR - 1)).not.toThrow();
  });
  it('throws CapExceededError at the cap', () => {
    expect(() => assertUnderCap(MAX_PHOTOS_PER_CAR)).toThrow(CapExceededError);
  });
});
