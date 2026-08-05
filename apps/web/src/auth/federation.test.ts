import { describe, expect, it } from 'vitest';
import { isFederatedPayload } from './federation';

describe('isFederatedPayload', () => {
  it('is true when the ID token carries an identities claim (Google sign-in)', () => {
    expect(isFederatedPayload({ identities: [{ providerName: 'Google' }] })).toBe(true);
    // Cognito serializes identities as a JSON string in some token versions.
    expect(isFederatedPayload({ identities: '[{"providerName":"Google"}]' })).toBe(true);
  });

  it('is false for native users and absent sessions', () => {
    expect(isFederatedPayload({ sub: 'abc', email: 'a@b.c' })).toBe(false);
    expect(isFederatedPayload(undefined)).toBe(false);
    expect(isFederatedPayload({})).toBe(false);
  });

  it('is false for an empty identities array', () => {
    expect(isFederatedPayload({ identities: [] })).toBe(false);
  });

  it('parses stringified identities explicitly rather than by length heuristic', () => {
    expect(isFederatedPayload({ identities: '[]' })).toBe(false);
    expect(isFederatedPayload({ identities: '[ ]' })).toBe(false);
    expect(isFederatedPayload({ identities: 'not-json' })).toBe(true); // unparseable — fail closed
  });

  it('is true for a non-array, non-string identities value (fail closed)', () => {
    expect(isFederatedPayload({ identities: { providerName: 'Google' } })).toBe(true);
  });
});