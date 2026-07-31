import { describe, it, expect, vi } from 'vitest';
import type { CognitoUserAdmin, CognitoUser } from './cognito-user-admin';
import { handleAdminRoute, type AdminRouteDeps } from './admin-routes';
import type { MetricsPort } from './cloudwatch-metrics';
import type { EventRepository } from '@carlog/domain';
import type { ApiEvent } from './router';

const other: CognitoUser = { username: 'other', sub: 'other-sub', email: 'o@x.com', status: 'CONFIRMED', enabled: true, createdAt: '2026-01-01T00:00:00.000Z' };
const port = (): CognitoUserAdmin => ({
  listUsers: vi.fn(async () => ({ users: [other] })),
  listGroupUsernames: vi.fn(async () => new Set<string>()),
  addToGroup: vi.fn(async () => {}), removeFromGroup: vi.fn(async () => {}),
  setEnabled: vi.fn(async () => {}), deleteUser: vi.fn(async () => {}),
  getSub: vi.fn(async () => 'other-sub'),
});
const metricsPort = (): MetricsPort => ({
  apiTraffic: vi.fn(async () => []),
  errorTotals: vi.fn(async () => ({ count4xx: 0, count5xx: 0, p95LatencyMs: 0 })),
  estimatedCost: vi.fn(async () => ({ currency: 'USD', amount: 0, series: [] })),
});
const eventsRepo = (): EventRepository => ({
  create: vi.fn(async (e) => e),
  listByCar: vi.fn(async () => []),
  getById: vi.fn(async () => null),
  update: vi.fn(async () => { throw new Error('not implemented'); }),
  delete: vi.fn(async () => {}),
  recentAcrossOwners: vi.fn(async () => []),
});
const deps = (over?: Partial<AdminRouteDeps>): AdminRouteDeps => ({
  users: port(), metrics: metricsPort(), events: eventsRepo(), apiId: 'api-1', ...over,
});
const base = (over: Partial<ApiEvent>): ApiEvent => ({
  method: 'GET', path: '/admin/users', ownerId: 'caller', groups: ['admin'],
  pathParams: {}, queryParams: {}, body: null, ...over,
});

describe('handleAdminRoute', () => {
  it('returns undefined for non-admin paths', async () => {
    expect(await handleAdminRoute(deps(), base({ path: '/cars' }))).toBeUndefined();
  });
  it('403s a non-admin caller', async () => {
    const res = await handleAdminRoute(deps(), base({ groups: [] }));
    expect(res?.statusCode).toBe(403);
  });
  it('lists users for an admin', async () => {
    const res = await handleAdminRoute(deps(), base({}));
    expect(res?.statusCode).toBe(200);
    expect(JSON.parse(res!.body as string).users).toHaveLength(1);
  });
  it('blocks an admin from revoking their own admin role', async () => {
    const selfPort: CognitoUserAdmin = { ...port(), getSub: vi.fn(async () => 'caller-sub') };
    const res = await handleAdminRoute(deps({ users: selfPort }), base({
      path: '/admin/users/me/admin', method: 'DELETE', pathParams: { username: 'me' },
      groups: ['admin'], ownerId: 'caller-sub',
    }));
    expect(res?.statusCode).toBe(409);
  });
  it('GET /admin/metrics returns 200 with a users object for an admin', async () => {
    const res = await handleAdminRoute(deps(), base({ path: '/admin/metrics' }));
    expect(res?.statusCode).toBe(200);
    expect(JSON.parse(res!.body as string).users).toEqual(expect.objectContaining({ total: expect.any(Number) }));
  });
  it('GET /admin/metrics 403s a non-admin caller', async () => {
    const res = await handleAdminRoute(deps(), base({ path: '/admin/metrics', groups: [] }));
    expect(res?.statusCode).toBe(403);
  });
});
