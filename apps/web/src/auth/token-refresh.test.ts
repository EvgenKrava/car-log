import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REFRESH_DELAY_MS,
  MIN_REFRESH_DELAY_MS,
  REFRESH_LEAD_MS,
  decodeJwtExp,
  refreshDelayMs,
} from './token-refresh';

/** Build a JWT-shaped string with the given payload (signature is irrelevant here). */
function makeToken(payload: Record<string, unknown>): string {
  const encode = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj), 'binary')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.sig`;
}

describe('decodeJwtExp', () => {
  it('reads exp from a valid token', () => {
    expect(decodeJwtExp(makeToken({ exp: 1_700_000_000 }))).toBe(1_700_000_000);
  });
  it('returns undefined for undefined/empty input', () => {
    expect(decodeJwtExp(undefined)).toBeUndefined();
    expect(decodeJwtExp('')).toBeUndefined();
  });
  it('returns undefined when exp is missing', () => {
    expect(decodeJwtExp(makeToken({ sub: 'abc' }))).toBeUndefined();
  });
  it('returns undefined for a malformed token', () => {
    expect(decodeJwtExp('not-a-jwt')).toBeUndefined();
    expect(decodeJwtExp('header.%%%not-base64%%%.sig')).toBeUndefined();
  });
});

describe('refreshDelayMs', () => {
  it('schedules REFRESH_LEAD_MS before a future expiry', () => {
    const now = 1_000_000_000_000; // ms
    const exp = now / 1000 + 3600; // one hour out, in seconds
    const token = makeToken({ exp });
    expect(refreshDelayMs(token, now)).toBe(3600 * 1000 - REFRESH_LEAD_MS);
  });

  it('clamps to the minimum delay for an already-expired token', () => {
    const now = 1_000_000_000_000;
    const exp = now / 1000 - 60; // expired a minute ago
    const token = makeToken({ exp });
    expect(refreshDelayMs(token, now)).toBe(MIN_REFRESH_DELAY_MS);
  });

  it('clamps to the minimum delay for a token expiring within the lead window', () => {
    const now = 1_000_000_000_000;
    const exp = now / 1000 + 10; // 10s out, inside the 60s lead
    const token = makeToken({ exp });
    expect(refreshDelayMs(token, now)).toBe(MIN_REFRESH_DELAY_MS);
  });

  it('falls back to the default interval for an undecodable token', () => {
    expect(refreshDelayMs('garbage')).toBe(DEFAULT_REFRESH_DELAY_MS);
    expect(refreshDelayMs(undefined)).toBe(DEFAULT_REFRESH_DELAY_MS);
  });

  it('falls back to the default interval when exp is absent', () => {
    expect(refreshDelayMs(makeToken({ sub: 'x' }))).toBe(DEFAULT_REFRESH_DELAY_MS);
  });
});