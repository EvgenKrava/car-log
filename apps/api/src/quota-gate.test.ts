import { describe, expect, it } from 'vitest';
import { quotaKindFor } from './quota-gate';

describe('quotaKindFor', () => {
  it.each([
    ['POST', '/cars/c1/chat/sessions/s1/messages', 'chat'],
    ['POST', '/import/scan', 'scan'],
    ['POST', '/import/extract', 'extract'],
    ['POST', '/import/jobs', 'import'],
    ['POST', '/cars/c1/chat/transcribe', 'transcribe'],
  ])('%s %s → %s', (method, path, kind) => {
    expect(quotaKindFor(method, path)).toBe(kind);
  });

  it.each([
    ['GET', '/cars/c1/chat/sessions/s1/messages'],
    ['POST', '/import/scan/presign'],
    ['GET', '/import/jobs'],
    ['POST', '/cars/c1/chat/sessions'],
    ['POST', '/cars/c1/chat/attachments/presign'],
    ['POST', '/cars'],
  ])('%s %s is not metered', (method, path) => {
    expect(quotaKindFor(method, path)).toBeNull();
  });
});
