import { SetEnabledSchema } from '@carlog/contracts';
import { ok, type ApiResult } from './errors';
import type { ApiEvent } from './router';
import { isAdmin } from './admin-guard';
import type { CognitoUserAdmin } from './cognito-user-admin';
import {
  listUsers, setAdmin, setEnabled, deleteUser, ForbiddenError, SelfLockoutError, type AdminActor,
} from './admin-service';

// Returns undefined for non-/admin paths so the main router can continue.
export async function handleAdminRoute(port: CognitoUserAdmin, event: ApiEvent): Promise<ApiResult | undefined> {
  const { method, path, ownerId, groups, pathParams, queryParams, body } = event;
  if (!path.startsWith('/admin/')) return undefined;

  const actor: AdminActor = { sub: ownerId ?? '', isAdmin: isAdmin(groups) };
  const username = pathParams.username;
  // targetSub is required by self-lockout checks; the client sends it as a query param
  // on mutating actions (it already has it from the list).
  const targetSub = queryParams.sub ?? '';

  try {
    if (path === '/admin/users' && method === 'GET') {
      return ok(200, await listUsers(port, actor, queryParams.nextToken));
    }
    if (username && path === `/admin/users/${username}/admin` && method === 'PUT') {
      await setAdmin(port, actor, username, targetSub, true);
      return ok(204, null);
    }
    if (username && path === `/admin/users/${username}/admin` && method === 'DELETE') {
      await setAdmin(port, actor, username, targetSub, false);
      return ok(204, null);
    }
    if (username && path === `/admin/users/${username}/enabled` && method === 'PUT') {
      const { enabled } = SetEnabledSchema.parse(body);
      await setEnabled(port, actor, username, enabled);
      return ok(204, null);
    }
    if (username && path === `/admin/users/${username}` && method === 'DELETE') {
      await deleteUser(port, actor, username, targetSub);
      return ok(204, null);
    }
    return ok(404, { error: 'Not found' });
  } catch (e) {
    if (e instanceof ForbiddenError) return ok(403, { error: 'Forbidden' });
    if (e instanceof SelfLockoutError) return ok(409, { error: e.message });
    throw e;
  }
}
