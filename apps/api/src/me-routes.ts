import { deleteAccount, type DeleteAccountDeps } from '@carlog/domain';
import { ok, type ApiResult } from './errors';
import type { ApiEvent } from './router';
import { isAdmin } from './admin-guard';

export type MeRouteDeps = DeleteAccountDeps & {
  /** Moves data from the user's old CarLog sign-in, if any. Returns rows moved. */
  claimLegacy: (sub: string, username: string) => Promise<number>;
};

// GET /me — the app calls it once after sign-in: it finishes the move from the old CarLog
// sign-in (first visit only) and tells the app the caller's role.
// DELETE /me — the caller purges their own CarLog data. Returns undefined otherwise.
export async function handleMeRoute(deps: MeRouteDeps, event: ApiEvent, ownerId: string): Promise<ApiResult | undefined> {
  if (event.path !== '/me') return undefined;
  if (event.method === 'GET') {
    const moved = event.username ? await deps.claimLegacy(ownerId, event.username) : 0;
    return ok(200, { sub: ownerId, isAdmin: isAdmin(event.groups), moved });
  }
  if (event.method !== 'DELETE') return undefined;
  if (!event.username) return ok(400, { error: 'ValidationError', message: 'missing username claim' });
  await deleteAccount(deps, ownerId, event.username);
  return ok(204, null);
}
