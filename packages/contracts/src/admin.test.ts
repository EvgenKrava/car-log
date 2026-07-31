import { describe, it, expect } from 'vitest';
import { AdminUserSchema, ListUsersResponseSchema, SetEnabledSchema } from './admin';

describe('admin contracts', () => {
  const user = {
    username: 'u-1', sub: '11111111-1111-1111-1111-111111111111', email: 'a@b.com',
    status: 'CONFIRMED', enabled: true, createdAt: '2026-01-01T00:00:00.000Z', isAdmin: false,
  };
  it('accepts a valid admin user', () => {
    expect(AdminUserSchema.parse(user)).toMatchObject({ email: 'a@b.com', isAdmin: false });
  });
  it('rejects a user missing sub', () => {
    const { sub, ...rest } = user;
    expect(() => AdminUserSchema.parse(rest)).toThrow();
  });
  it('parses a list response with optional nextToken', () => {
    expect(ListUsersResponseSchema.parse({ users: [user] })).toMatchObject({ users: [{ email: 'a@b.com' }] });
    expect(ListUsersResponseSchema.parse({ users: [], nextToken: 'x' }).nextToken).toBe('x');
  });
  it('validates SetEnabled body', () => {
    expect(SetEnabledSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(() => SetEnabledSchema.parse({})).toThrow();
  });
});