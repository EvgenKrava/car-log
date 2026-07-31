import { describe, it, expect } from 'vitest';
import { MetricsResponseSchema } from './metrics';

describe('metrics contracts', () => {
  const valid = {
    users: { total: 3, admins: 1, newLast30d: 2 },
    apiTraffic: [{ date: '2026-07-01', count: 120 }],
    errors: { count4xx: 4, count5xx: 1, p95LatencyMs: 210 },
    cost: { currency: 'USD', amount: 12.34, series: [{ date: '2026-07-01', amount: 1.2 }] },
    activity: [{ carId: 'c1', category: 'oil_change', date: '2026-07-01', cost: 100, currency: 'UAH', createdAt: '2026-07-01T10:00:00.000Z', ownerId: 'u1' }],
  };
  it('accepts a full payload', () => {
    expect(MetricsResponseSchema.parse(valid)).toMatchObject({ users: { total: 3 } });
  });
  it('rejects a bad point', () => {
    expect(() => MetricsResponseSchema.parse({ ...valid, apiTraffic: [{ date: 'x' }] })).toThrow();
  });
});
