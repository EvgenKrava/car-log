// Pure helpers for proactively refreshing the Cognito access token before it expires.
//
// Cognito access tokens are short-lived (~1h). Rather than let the cached token go stale
// and cause 401s, we decode the JWT `exp` claim and schedule a refresh shortly before it.

/** Refresh this many ms before the token's `exp`, so the new token is in hand before the old dies. */
export const REFRESH_LEAD_MS = 60_000;

/** Floor for the scheduled delay, so a near/at-expiry token can't trigger a tight refresh loop. */
export const MIN_REFRESH_DELAY_MS = 5_000;

/** Fallback interval used when the token has no usable `exp` claim (~45 min). */
export const DEFAULT_REFRESH_DELAY_MS = 45 * 60_000;

type JwtPayload = {
  exp?: number;
};

/** Decode the `exp` (unix seconds) claim from a JWT access token, or undefined if it can't be read. */
export function decodeJwtExp(token: string | undefined): number | undefined {
  if (!token) return undefined;
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return undefined;
  try {
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeBase64(base64);
    const payload = JSON.parse(json) as JwtPayload;
    if (typeof payload.exp === 'number' && Number.isFinite(payload.exp)) {
      return payload.exp;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Compute how long (ms) to wait before refreshing the access token again.
 *
 * - Valid `exp` in the future: schedule REFRESH_LEAD_MS before expiry, clamped to MIN_REFRESH_DELAY_MS.
 * - Already expired / about to expire: MIN_REFRESH_DELAY_MS (avoids a tight loop).
 * - Malformed / undecodable / no `exp`: DEFAULT_REFRESH_DELAY_MS.
 */
export function refreshDelayMs(token: string | undefined, nowMs: number = Date.now()): number {
  const exp = decodeJwtExp(token);
  if (exp === undefined) return DEFAULT_REFRESH_DELAY_MS;
  const target = exp * 1000 - REFRESH_LEAD_MS;
  return Math.max(MIN_REFRESH_DELAY_MS, target - nowMs);
}

function decodeBase64(base64: string): string {
  if (typeof atob === 'function') {
    return atob(base64);
  }
  // Non-browser environments (SSR/tests without a DOM) fall back to Buffer.
  return Buffer.from(base64, 'base64').toString('binary');
}