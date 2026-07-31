import type { ListUsersResponse, AdminUser } from '@carlog/contracts';
import { ADMIN_GROUP } from './admin-guard';
import type { CognitoUserAdmin } from './cognito-user-admin';

export class ForbiddenError extends Error {}
export class SelfLockoutError extends Error {}

export type AdminActor = { sub: string; isAdmin: boolean };

function requireAdmin(actor: AdminActor): void {
  if (!actor.isAdmin) throw new ForbiddenError('Admin role required');
}

export async function listUsers(port: CognitoUserAdmin, actor: AdminActor, nextToken?: string): Promise<ListUsersResponse> {
  requireAdmin(actor);
  const [{ users, nextToken: next }, adminUsernames] = await Promise.all([
    port.listUsers(nextToken),
    port.listGroupUsernames(ADMIN_GROUP),
  ]);
  const mapped: AdminUser[] = users.map((u) => ({
    username: u.username, sub: u.sub, email: u.email, status: u.status,
    enabled: u.enabled, createdAt: u.createdAt, isAdmin: adminUsernames.has(u.username),
  }));
  return { users: mapped, nextToken: next };
}

export async function setAdmin(port: CognitoUserAdmin, actor: AdminActor, username: string, targetSub: string, makeAdmin: boolean): Promise<void> {
  requireAdmin(actor);
  if (!makeAdmin && targetSub === actor.sub) throw new SelfLockoutError('You cannot revoke your own admin role');
  if (makeAdmin) await port.addToGroup(username, ADMIN_GROUP);
  else await port.removeFromGroup(username, ADMIN_GROUP);
}

export async function setEnabled(port: CognitoUserAdmin, actor: AdminActor, username: string, enabled: boolean): Promise<void> {
  requireAdmin(actor);
  await port.setEnabled(username, enabled);
}

export async function deleteUser(port: CognitoUserAdmin, actor: AdminActor, username: string, targetSub: string): Promise<void> {
  requireAdmin(actor);
  if (targetSub === actor.sub) throw new SelfLockoutError('You cannot delete yourself');
  await port.deleteUser(username);
}