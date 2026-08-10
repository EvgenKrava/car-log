import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryPushSubscriptionRepository } from './in-memory-push-subscription-repository';
import { handlePushRoute, hashEndpoint, type PushDeps } from './push-routes';
import type { ApiEvent } from './router';

const OWNER = 'owner-1';

const subscriptionBody = (endpoint: string, lang: 'uk' | 'en' = 'en') => ({
  endpoint,
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
  lang,
});

const post = (body: unknown, ownerId = OWNER): ApiEvent => ({
  method: 'POST', path: '/push/subscription', ownerId, groups: [],
  pathParams: {}, queryParams: {}, body,
});
const del = (body: unknown, ownerId = OWNER): ApiEvent => ({
  method: 'DELETE', path: '/push/subscription', ownerId, groups: [],
  pathParams: {}, queryParams: {}, body,
});

describe('push subscription routes', () => {
  let deps: PushDeps;
  beforeEach(() => {
    deps = { pushSubs: new InMemoryPushSubscriptionRepository() };
  });

  it('POST creates a row keyed to the JWT owner', async () => {
    const endpoint = 'https://push.example.com/sub/aaa';
    const res = await handlePushRoute(deps, post(subscriptionBody(endpoint)), OWNER);
    expect(res?.statusCode).toBe(204);

    const rows = await deps.pushSubs.listAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ownerId).toBe(OWNER);
    expect(rows[0]?.subscription.endpoint).toBe(endpoint);
    expect(rows[0]?.lang).toBe('en');
    expect(rows[0]?.lastNotified).toEqual({});
  });

  it('re-POSTing the same endpoint preserves a seeded lastNotified', async () => {
    const endpoint = 'https://push.example.com/sub/bbb';
    await handlePushRoute(deps, post(subscriptionBody(endpoint)), OWNER);
    const endpointHash = hashEndpoint(endpoint);
    await deps.pushSubs.saveLastNotified(OWNER, endpointHash, { 'car1#mileage': '2026-08-01' });

    await handlePushRoute(deps, post(subscriptionBody(endpoint, 'uk')), OWNER);

    const rows = await deps.pushSubs.listAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastNotified).toEqual({ 'car1#mileage': '2026-08-01' });
    expect(rows[0]?.lang).toBe('uk'); // other fields still refresh
  });

  it('different endpoints create two separate rows', async () => {
    await handlePushRoute(deps, post(subscriptionBody('https://push.example.com/sub/one')), OWNER);
    await handlePushRoute(deps, post(subscriptionBody('https://push.example.com/sub/two')), OWNER);
    expect(await deps.pushSubs.listAll()).toHaveLength(2);
  });

  it('DELETE removes only the matching row', async () => {
    const endpointA = 'https://push.example.com/sub/ccc';
    const endpointB = 'https://push.example.com/sub/ddd';
    await handlePushRoute(deps, post(subscriptionBody(endpointA)), OWNER);
    await handlePushRoute(deps, post(subscriptionBody(endpointB)), OWNER);

    const res = await handlePushRoute(deps, del({ endpoint: endpointA }), OWNER);
    expect(res?.statusCode).toBe(204);

    const rows = await deps.pushSubs.listAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subscription.endpoint).toBe(endpointB);
  });

  it('hash is stable across calls for the same endpoint', () => {
    const endpoint = 'https://push.example.com/sub/eee';
    expect(hashEndpoint(endpoint)).toBe(hashEndpoint(endpoint));
    expect(hashEndpoint(endpoint)).not.toBe(hashEndpoint('https://push.example.com/sub/fff'));
  });

  it('a non-url endpoint propagates a ZodError from POST', async () => {
    await expect(handlePushRoute(deps, post(subscriptionBody('not-a-url')), OWNER)).rejects.toThrow();
  });

  it('a non-url endpoint propagates a ZodError from DELETE', async () => {
    await expect(handlePushRoute(deps, del({ endpoint: 'not-a-url' }), OWNER)).rejects.toThrow();
  });

  it('returns null for non-matching paths', async () => {
    const res = await handlePushRoute(deps, { ...post(subscriptionBody('https://push.example.com/sub/x')), path: '/push/other' }, OWNER);
    expect(res).toBeNull();
  });

  it('returns null for a non-matching method', async () => {
    const res = await handlePushRoute(deps, { ...post(subscriptionBody('https://push.example.com/sub/x')), method: 'GET' }, OWNER);
    expect(res).toBeNull();
  });
});
