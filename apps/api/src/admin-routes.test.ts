import { describe, it, expect, vi } from 'vitest';
import type { CognitoUserAdmin, CognitoUser } from './cognito-user-admin';
import { handleAdminRoute } from './admin-routes';
import type { ApiEvent } from './router';

const other: CognitoUser = { username: 'other', sub: 'other-sub', email: 'o@x.com', status: 'CONFIRMED', enabled: true, createdAt: '2026-01-01T00:00:00.000Z' };
const port = (): CognitoUserAdmin => ({
  listUsers: vi.fn(async () => ({ users: [other] })),
  listGroupUsernames: vi.fn(async () => new Set<string>()),
  addToGroup: vi.fn(async () => {}), removeFromGroup: vi.fn(async () => {}),
  setEnabled: vi.fn(async () => {}), deleteUser: vi.fn(async () => {}),
  getSub: vi.fn(async () => 'other-sub'),
});
const base = (over: Partial<ApiEvent>): ApiEvent => ({
  method: 'GET', path: '/admin/users', ownerId: 'caller', groups: ['admin'],
  pathParams: {}, queryParams: {}, body: null, ...over,
});

describe('handleAdminRoute', () => {
  it('returns undefined for non-admin paths', async () => {
    expect(await handleAdminRoute(port(), base({ path: '/cars' }))).toBeUndefined();
  });
  it('403s a non-admin caller', async () => {
    const res = await handleAdminRoute(port(), base({ groups: [] }));
    expect(res?.statusCode).toBe(403);
  });
  it('lists users for an admin', async () => {
    const res = await handleAdminRoute(port(), base({}));
    expect(res?.statusCode).toBe(200);
    expect(JSON.parse(res!.body as string).users).toHaveLength(1);
  });
  it('blocks an admin from revoking their own admin role', async () => {
    const selfPort: CognitoUserAdmin = { ...port(), getSub: vi.fn(async () => 'caller-sub') };
    const res = await handleAdminRoute(selfPort, base({
      path: '/admin/users/me/admin', method: 'DELETE', pathParams: { username: 'me' },
      groups: ['admin'], ownerId: 'caller-sub',
    }));
    expect(res?.statusCode).toBe(409);
  });
});
