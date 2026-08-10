import type { PushSubscription } from '@carlog/contracts';
import type { PushSender } from './notify-worker';

// Test double for PushSender: records every send and can be scripted to answer 'gone'
// for a given endpoint (simulating a 404/410 from the push service), or to throw
// (simulating a transient send failure) — both paths the worker must handle per-row.
export class InMemoryPushSender implements PushSender {
  readonly sent: { subscription: PushSubscription; payload: string }[] = [];
  private goneEndpoints = new Set<string>();
  private throwingEndpoints = new Set<string>();

  markGone(endpoint: string): void {
    this.goneEndpoints.add(endpoint);
  }

  markThrowing(endpoint: string): void {
    this.throwingEndpoints.add(endpoint);
  }

  async send(subscription: PushSubscription, payload: string): Promise<'ok' | 'gone'> {
    if (this.throwingEndpoints.has(subscription.endpoint)) {
      throw new Error('push send failed');
    }
    this.sent.push({ subscription, payload });
    return this.goneEndpoints.has(subscription.endpoint) ? 'gone' : 'ok';
  }
}
