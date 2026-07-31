import { describe, it, expect, vi } from 'vitest';
import { getMetrics } from './metrics-service';
import { ForbiddenError } from './admin-service';

const now = new Date('2026-07-31T00:00:00.000Z');
const users = (createDates: string[]) => ({
  listUsers: vi.fn(async () => ({ users: createDates.map((d, i) => ({ username: `u${i}`, sub: `s${i}`, email: `${i}@x.com`, status: 'CONFIRMED', enabled: true, createdAt: d })), nextToken: undefined })),
  listGroupUsernames: vi.fn(async () => new Set(['u0'])),
  getSub: vi.fn(async () => null), addToGroup: vi.fn(), removeFromGroup: vi.fn(), setEnabled: vi.fn(), deleteUser: vi.fn(),
});
const metrics = { apiTraffic: vi.fn(async () => []), errorTotals: vi.fn(async () => ({ count4xx: 0, count5xx: 0, p95LatencyMs: 0 })), estimatedCost: vi.fn(async () => ({ currency: 'USD', amount: 0, series: [] })) };
const events = { recentAcrossOwners: vi.fn(async () => []) } as never;

describe('getMetrics', () => {
  it('rejects non-admin', async () => {
    await expect(getMetrics({ users: users([]) as never, metrics, events, apiId: 'a', now }, { sub: 'x', isAdmin: false })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('counts newLast30d by cutoff', async () => {
    const res = await getMetrics({ users: users(['2026-07-21T00:00:00.000Z', '2026-06-01T00:00:00.000Z']) as never, metrics, events, apiId: 'a', now }, { sub: 'x', isAdmin: true });
    expect(res.users).toMatchObject({ total: 2, admins: 1, newLast30d: 1 });
  });

  it('maps recent events to activity items', async () => {
    const event = {
      id: 'e1', carId: 'car1', ownerId: 'owner1', category: 'oil_change', date: '2026-07-20',
      cost: 42, currency: 'UAH', createdAt: '2026-07-20T10:00:00.000Z', updatedAt: '2026-07-20T10:00:00.000Z',
      mileage: 1000, works: [],
    };
    const eventsWithData = { recentAcrossOwners: vi.fn(async () => [event]) } as never;
    const res = await getMetrics({ users: users([]) as never, metrics, events: eventsWithData, apiId: 'a', now }, { sub: 'x', isAdmin: true });
    expect(res.activity).toEqual([
      { carId: 'car1', category: 'oil_change', date: '2026-07-20', cost: 42, currency: 'UAH', createdAt: '2026-07-20T10:00:00.000Z', ownerId: 'owner1' },
    ]);
  });
});
