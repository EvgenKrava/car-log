import { describe, expect, it } from 'vitest';
import { PushSubscriptionSchema, PushUnsubscribeSchema } from './push';

const browserSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'p256dh-key-value', auth: 'auth-key-value' },
};

describe('PushSubscriptionSchema', () => {
  it('accepts a browser-shaped subscription', () => {
    const parsed = PushSubscriptionSchema.parse(browserSubscription);
    expect(parsed.endpoint).toBe(browserSubscription.endpoint);
    expect(parsed.keys).toEqual(browserSubscription.keys);
  });

  it('defaults lang to en when omitted', () => {
    expect(PushSubscriptionSchema.parse(browserSubscription).lang).toBe('en');
  });

  it('accepts an explicit uk lang', () => {
    expect(PushSubscriptionSchema.parse({ ...browserSubscription, lang: 'uk' }).lang).toBe('uk');
  });

  it('rejects a non-url endpoint', () => {
    expect(() => PushSubscriptionSchema.parse({ ...browserSubscription, endpoint: 'not-a-url' })).toThrow();
  });

  it('rejects a subscription missing keys', () => {
    const { keys, ...withoutKeys } = browserSubscription;
    void keys;
    expect(() => PushSubscriptionSchema.parse(withoutKeys)).toThrow();
  });
});

describe('PushUnsubscribeSchema', () => {
  it('accepts an endpoint-only payload', () => {
    expect(PushUnsubscribeSchema.parse({ endpoint: browserSubscription.endpoint }).endpoint)
      .toBe(browserSubscription.endpoint);
  });

  it('rejects a non-url endpoint', () => {
    expect(() => PushUnsubscribeSchema.parse({ endpoint: 'nope' })).toThrow();
  });
});
