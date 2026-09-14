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
