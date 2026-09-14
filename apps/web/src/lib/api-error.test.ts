import { describe, expect, it } from 'vitest';
import { ApiError, quotaErrorInfo } from './api-error';

describe('quotaErrorInfo', () => {
  it('extracts kind + resetsAt from a QuotaExceeded 429', () => {
    const err = new ApiError(429, { error: 'QuotaExceeded', kind: 'chat', resetsAt: '2026-09-15T00:00:00.000Z' });
    expect(quotaErrorInfo(err)).toEqual({ kind: 'chat', resetsAt: '2026-09-15T00:00:00.000Z' });
    expect(err.message).toBe('API 429');
  });
  it('is null for other errors', () => {
    expect(quotaErrorInfo(new ApiError(429, { error: 'Other' }))).toBeNull();
    expect(quotaErrorInfo(new ApiError(503, null))).toBeNull();
    expect(quotaErrorInfo(new Error('API 429'))).toBeNull();
  });
});
