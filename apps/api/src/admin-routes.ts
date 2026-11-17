import { SetEnabledSchema, TestAiSettingsSchema, UpdateAiSettingsSchema } from '@carlog/contracts';
import type { CarRepository, EventRepository, PhotoStorage, UserDataRepository } from '@carlog/domain';
import { ok, type ApiResult } from './errors';
import type { ApiEvent } from './router';
import { isAdmin } from './admin-guard';
import type { CognitoUserAdmin } from './cognito-user-admin';
import type { MetricsPort } from './cloudwatch-metrics';
import { getMetrics } from './metrics-service';
import {
  listUsers, setAdmin, setEnabled, deleteUser, requireAdmin, ForbiddenError, SelfLockoutError, type AdminActor,
} from './admin-service';
import {
  getAiSettings, updateAiSettings, testAiSettings, NoAnthropicKeyError, type AiSettingsDeps,
} from './ai-settings-service';

export type AdminRouteDeps = {
  users: CognitoUserAdmin;
  metrics: MetricsPort;
  events: EventRepository;
  apiId: string;
  // Admin delete purges the target's data the same way self-service deletion does.
  cars: CarRepository;
  storage: PhotoStorage;
  userData: UserDataRepository;
  // App-wide AI provider/model choice and the Claude API key.
  ai: AiSettingsDeps;
};

// Returns undefined for non-/admin paths so the main router can continue.
export async function handleAdminRoute(deps: AdminRouteDeps, event: ApiEvent): Promise<ApiResult | undefined> {
  const { method, path, ownerId, groups, pathParams, queryParams, body } = event;
  if (!path.startsWith('/admin/')) return undefined;

  const actor: AdminActor = { sub: ownerId ?? '', isAdmin: isAdmin(groups) };
  const username = pathParams.username;
  const port = deps.users;

  try {
    if (path === '/admin/users' && method === 'GET') {
      return ok(200, await listUsers(port, actor, queryParams.nextToken));
    }
    if (username && path === `/admin/users/${username}/admin` && method === 'PUT') {
      await setAdmin(port, actor, username, '', true);
      return ok(204, null);
    }
    if (username && path === `/admin/users/${username}/admin` && method === 'DELETE') {
      const targetSub = (await port.getSub(username)) ?? null;
      if (targetSub === null) return ok(404, { error: 'User not found' });
      await setAdmin(port, actor, username, targetSub, false);
      return ok(204, null);
    }
    if (username && path === `/admin/users/${username}/enabled` && method === 'PUT') {
      const { enabled } = SetEnabledSchema.parse(body);
      const targetSub = (await port.getSub(username)) ?? null;
      if (targetSub === null) return ok(404, { error: 'User not found' });
      await setEnabled(port, actor, username, targetSub, enabled);
      return ok(204, null);
    }
    if (username && path === `/admin/users/${username}` && method === 'DELETE') {
      const targetSub = (await port.getSub(username)) ?? null;
      if (targetSub === null) return ok(404, { error: 'User not found' });
      await deleteUser(port, actor, username, targetSub, {
        cars: deps.cars, storage: deps.storage, userData: deps.userData, identity: port,
      });
      return ok(204, null);
    }
    if (path === '/admin/metrics' && method === 'GET') {
      return ok(200, await getMetrics(
        { users: deps.users, metrics: deps.metrics, events: deps.events, apiId: deps.apiId, now: new Date() },
        actor,
      ));
    }
    if (path === '/admin/ai-settings' && method === 'GET') {
      return ok(200, await getAiSettings(deps.ai, actor));
    }
    if (path === '/admin/ai-settings' && method === 'PUT') {
      requireAdmin(actor); // 403 before the body is validated
      return ok(200, await updateAiSettings(deps.ai, actor, UpdateAiSettingsSchema.parse(body)));
    }
    if (path === '/admin/ai-settings/test' && method === 'POST') {
      requireAdmin(actor); // 403 before the body is validated
      return ok(200, await testAiSettings(deps.ai, actor, TestAiSettingsSchema.parse(body)));
    }
    return ok(404, { error: 'Not found' });
  } catch (e) {
    if (e instanceof ForbiddenError) return ok(403, { error: 'Forbidden' });
    if (e instanceof NoAnthropicKeyError) return ok(400, { error: 'NoAnthropicKey', message: e.message });
    if (e instanceof SelfLockoutError) return ok(409, { error: e.message });
    throw e;
  }
}
