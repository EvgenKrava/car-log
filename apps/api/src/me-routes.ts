import { deleteAccount, type DeleteAccountDeps } from '@carlog/domain';
import { ok, type ApiResult } from './errors';
import type { ApiEvent } from './router';

// Handles DELETE /me — the caller purges their own account. Returns undefined otherwise.
export async function handleMeRoute(deps: DeleteAccountDeps, event: ApiEvent, ownerId: string): Promise<ApiResult | undefined> {
  if (event.path !== '/me' || event.method !== 'DELETE') return undefined;
  if (!event.username) return ok(400, { error: 'ValidationError', message: 'missing username claim' });
  await deleteAccount(deps, ownerId, event.username);
  return ok(204, null);
}
