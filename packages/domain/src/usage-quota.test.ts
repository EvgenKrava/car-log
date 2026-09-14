import { describe, expect, it, vi } from 'vitest';
import {
  DAILY_QUOTA, QuotaExceededError, consumeQuota, quotaDay, quotaResetsAt, type UsageQuota,
} from './usage-quota';

const at = new Date('2026-09-14T15:30:00.000Z');

describe('quotaDay / quotaResetsAt', () => {
  it('uses the UTC calendar date', () => {
    expect(quotaDay(at)).toBe('2026-09-14');
    expect(quotaDay(new Date('2026-09-14T23:59:59.999Z'))).toBe('2026-09-14');
  });
  it('resets at the next UTC midnight', () => {
    expect(quotaResetsAt('2026-09-14')).toBe('2026-09-15T00:00:00.000Z');
    expect(quotaResetsAt('2026-12-31')).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('consumeQuota', () => {
  it('passes the configured limit and today to the port', async () => {
    const consume = vi.fn(async () => true);
    await consumeQuota({ consume }, 'u1', 'import', false, at);
    expect(consume).toHaveBeenCalledWith('u1', 'import', DAILY_QUOTA.import, '2026-09-14');
  });
  it('throws QuotaExceededError with kind + resetsAt when the port refuses', async () => {
    const quota: UsageQuota = { consume: async () => false };
    await expect(consumeQuota(quota, 'u1', 'chat', false, at)).rejects.toMatchObject({
      name: 'QuotaExceededError', kind: 'chat', resetsAt: '2026-09-15T00:00:00.000Z',
    });
    await expect(consumeQuota(quota, 'u1', 'chat', false, at)).rejects.toBeInstanceOf(QuotaExceededError);
  });
  it('bypasses the port entirely for admins', async () => {
    const consume = vi.fn(async () => false);
    await expect(consumeQuota({ consume }, 'u1', 'scan', true, at)).resolves.toBeUndefined();
    expect(consume).not.toHaveBeenCalled();
  });
});
