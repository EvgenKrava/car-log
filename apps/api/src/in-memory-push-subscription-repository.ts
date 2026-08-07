import type { PushSubscriptionRecord, PushSubscriptionRepository } from './push-subscription-repository';

// Single map keyed by ownerId|endpointHash so key collisions surface in tests (repo
// convention — see in-memory-import-job-repository.ts).
export class InMemoryPushSubscriptionRepository implements PushSubscriptionRepository {
  private rows = new Map<string, PushSubscriptionRecord>();
  private key(ownerId: string, endpointHash: string): string { return `${ownerId}|${endpointHash}`; }

  async upsert(rec: PushSubscriptionRecord): Promise<void> {
    const key = this.key(rec.ownerId, rec.endpointHash);
    const existing = this.rows.get(key);
    this.rows.set(key, structuredClone({ ...rec, lastNotified: existing?.lastNotified ?? rec.lastNotified }));
  }

  async listAll(): Promise<PushSubscriptionRecord[]> {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }

  async delete(ownerId: string, endpointHash: string): Promise<void> {
    this.rows.delete(this.key(ownerId, endpointHash));
  }

  async saveLastNotified(ownerId: string, endpointHash: string, map: Record<string, string>): Promise<void> {
    const key = this.key(ownerId, endpointHash);
    const existing = this.rows.get(key);
    if (!existing) return;
    this.rows.set(key, structuredClone({ ...existing, lastNotified: map }));
  }
}
