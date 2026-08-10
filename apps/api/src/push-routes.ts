import { createHash } from 'node:crypto';
import { PushSubscriptionSchema, PushUnsubscribeSchema } from '@carlog/contracts';
import { nowIso } from '@carlog/domain';
import { ok, type ApiResult } from './errors';
import type { ApiEvent } from './router';
import type { PushSubscriptionRepository } from './push-subscription-repository';

export type PushDeps = { pushSubs: PushSubscriptionRepository };

// sha256 hex digest of the endpoint URL, first 32 chars — a stable, fixed-length row key
// that never leaks the raw (potentially identifying) push endpoint into logs/DynamoDB
// keys verbatim. node:crypto usage stays in this API-layer file, never in domain.
export const hashEndpoint = (endpoint: string): string => createHash('sha256').update(endpoint).digest('hex').slice(0, 32);

// Handles POST/DELETE /push/subscription; returns null otherwise.
export async function handlePushRoute(
  deps: PushDeps, event: ApiEvent, ownerId: string,
): Promise<ApiResult | null> {
  if (event.path !== '/push/subscription') return null;

  if (event.method === 'POST') {
    const subscription = PushSubscriptionSchema.parse(event.body);
    const endpointHash = hashEndpoint(subscription.endpoint);
    await deps.pushSubs.upsert({
      ownerId,
      endpointHash,
      subscription,
      lang: subscription.lang,
      lastNotified: {},
      updatedAt: nowIso(),
    });
    return ok(204, null);
  }

  if (event.method === 'DELETE') {
    const { endpoint } = PushUnsubscribeSchema.parse(event.body);
    await deps.pushSubs.delete(ownerId, hashEndpoint(endpoint));
    return ok(204, null);
  }

  return null;
}
