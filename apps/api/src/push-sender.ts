import webpush from 'web-push';
import type { PushSubscription } from '@carlog/contracts';
import type { PushSender } from './notify-worker';

// VAPID from env (SSM-resolved at synth, same mechanism as the Bedrock bearer token —
// see infrastructure/cdk/bin/carlog.ts). Real implementation of the PushSender port
// defined in notify-worker.ts; the worker and its tests depend only on that port.
export class WebPushSender implements PushSender {
  constructor() {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? 'mailto:admin@carlog.app',
      process.env.VAPID_PUBLIC_KEY ?? '',
      process.env.VAPID_PRIVATE_KEY ?? '',
    );
  }

  async send(sub: PushSubscription, payload: string): Promise<'ok' | 'gone'> {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
      return 'ok';
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      console.error('push send failed', status);
      throw err; // worker catches per-subscription
    }
  }
}
