// Per-user daily caps on the metered (AI / transcription) operations. Counted by
// request, not by model call: one chat turn = 1 `chat` regardless of tool rounds.

export type QuotaKind = 'chat' | 'scan' | 'extract' | 'import' | 'transcribe';

export const DAILY_QUOTA: Record<QuotaKind, number> = {
  chat: 50, scan: 10, extract: 10, import: 3, transcribe: 30,
};

// Port: atomically increments the (owner, kind, day) counter and reports whether the
// increment was allowed. Returning false means the counter was already at `limit` and
// was NOT incremented.
export interface UsageQuota {
  consume(ownerId: string, kind: QuotaKind, limit: number, day: string): Promise<boolean>;
}

export class QuotaExceededError extends Error {
  constructor(readonly kind: QuotaKind, readonly resetsAt: string) {
    super(`Daily ${kind} limit reached`);
    this.name = 'QuotaExceededError';
  }
}

// UTC calendar date — the quota window boundary.
export const quotaDay = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

// Midnight UTC of the day after `day`, as ISO — reported in the 429 body.
export const quotaResetsAt = (day: string): string =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString();

export async function consumeQuota(
  quota: UsageQuota, ownerId: string, kind: QuotaKind, isAdmin: boolean, now: Date = new Date(),
): Promise<void> {
  if (isAdmin) return;
  const day = quotaDay(now);
  const allowed = await quota.consume(ownerId, kind, DAILY_QUOTA[kind], day);
  if (!allowed) throw new QuotaExceededError(kind, quotaResetsAt(day));
}
