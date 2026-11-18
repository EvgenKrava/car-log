import { describe, expect, it } from 'vitest';
import { legacyKey, rekey } from './legacy-claim';

describe('rekey', () => {
  it('replaces the old sub in keys, attributes and S3 keys', () => {
    const item = { PK: 'USER#old-1', SK: 'CAR#c1#EVENT#e1', ownerId: 'old-1', s3Key: 'proofs/old-1/c1/e1/p1', n: 3 };
    expect(rekey(item, 'old-1', 'new-2')).toEqual({ PK: 'USER#new-2', SK: 'CAR#c1#EVENT#e1', ownerId: 'new-2', s3Key: 'proofs/new-2/c1/e1/p1', n: 3 });
  });
});

describe('legacyKey', () => {
  it('normalises the email', () => {
    expect(legacyKey('  Foo@Example.COM ')).toEqual({ PK: 'LEGACY#foo@example.com', SK: 'LEGACY' });
  });
});
