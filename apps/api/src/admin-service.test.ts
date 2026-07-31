import { describe, it, expect, vi } from 'vitest';
import type { CognitoUserAdmin, CognitoUser } from './cognito-user-admin';
import { listUsers, setAdmin, deleteUser, ForbiddenError, SelfLockoutError } from './admin-service';

const CALLER = { sub: 'caller-sub', isAdmin: true };
const other: CognitoUser = { username: 'other', sub: 'other-sub', email: 'o@x.com', status: 'CONFIRMED', enabled: true, createdAt: '2026-01-01T00:00:00.000Z' };

function fakePort(overrides: Partial<CognitoUserAdmin> = {}): CognitoUserAdmin {
  return {
    listUsers: vi.fn(async () => ({ users: [other], nextToken: undefined })),
    listGroupUsernames: vi.fn(async () => new Set<string>(['other'])),
    addToGroup: vi.fn(async () => {}),
    removeFromGroup: vi.fn(async () => {}),
    setEnabled: vi.fn(async () => {}),
    deleteUser: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('admin-service authorization', () => {
  it('rejects non-admin callers', async () => {
    await expect(listUsers(fakePort(), { sub: 'x', isAdmin: false })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('lists users with isAdmin derived from group membership', async () => {
    const res = await listUsers(fakePort(), CALLER);
    expect(res.users[0]).toMatchObject({ username: 'other', isAdmin: true });
  });
});

describe('self-lockout guards', () => {
  it('blocks revoking your own admin', async () => {
    await expect(setAdmin(fakePort(), CALLER, 'me', 'caller-sub', false)).rejects.toBeInstanceOf(SelfLockoutError);
  });
  it('blocks deleting yourself', async () => {
    await expect(deleteUser(fakePort(), CALLER, 'me', 'caller-sub')).rejects.toBeInstanceOf(SelfLockoutError);
  });
  it('allows revoking another admin', async () => {
    const port = fakePort();
    await setAdmin(port, CALLER, 'other', 'other-sub', false);
    expect(port.removeFromGroup).toHaveBeenCalledWith('other', 'admin');
  });
});