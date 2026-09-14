import type { QuotaKind, UsageQuota } from '@carlog/domain';

export class InMemoryUsageQuota implements UsageQuota {
  readonly counts = new Map<string, number>();

  async consume(ownerId: string, kind: QuotaKind, limit: number, day: string): Promise<boolean> {
    const key = `${ownerId}#${kind}#${day}`;
    const current = this.counts.get(key) ?? 0;
    if (current >= limit) return false;
    this.counts.set(key, current + 1);
    return true;
  }
}
