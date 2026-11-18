// Typed API failure. `message` keeps the legacy "API <status>" shape because several
// dialogs branch on `.includes('503')`.
export class ApiError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`API ${status}`);
    this.name = 'ApiError';
  }
}

export type QuotaErrorInfo = { kind: string; resetsAt: string };

// Non-null only for a 429 carrying the server's QuotaExceeded body.
export function quotaErrorInfo(err: unknown): QuotaErrorInfo | null {
  if (!(err instanceof ApiError) || err.status !== 429) return null;
  const b = err.body as { error?: unknown; kind?: unknown; resetsAt?: unknown } | null;
  if (!b || b.error !== 'QuotaExceeded' || typeof b.kind !== 'string' || typeof b.resetsAt !== 'string') return null;
  return { kind: b.kind, resetsAt: b.resetsAt };
}

export type PlanLimitInfo = { kind: 'cars' | 'ocrScansPerMonth'; limit: number; plan: 'free' | 'plus' };
export const UPGRADE_URL = 'https://onlytools.click/plus/';

// Non-null only for a 402 carrying the server's PlanLimit body (Free / Plus allowance).
export function planLimitInfo(err: unknown): PlanLimitInfo | null {
  if (!(err instanceof ApiError) || err.status !== 402) return null;
  const b = err.body as { error?: unknown; kind?: unknown; limit?: unknown; plan?: unknown } | null;
  if (!b || b.error !== 'PlanLimit' || (b.kind !== 'cars' && b.kind !== 'ocrScansPerMonth') || typeof b.limit !== 'number') return null;
  return { kind: b.kind, limit: b.limit, plan: b.plan === 'plus' ? 'plus' : 'free' };
}
