import { z } from 'zod';

// The browser's PushSubscription.toJSON() shape, plus the app locale captured at
// subscribe time (used by the notify worker to pick a copy language server-side).
export const PushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(300),
    auth: z.string().min(1).max(100),
  }),
  lang: z.enum(['uk', 'en']).default('en'),
});

export const PushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
});

export type PushSubscription = z.infer<typeof PushSubscriptionSchema>;
export type PushUnsubscribe = z.infer<typeof PushUnsubscribeSchema>;
