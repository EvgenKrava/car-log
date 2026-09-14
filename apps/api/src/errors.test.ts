import { describe, expect, it } from 'vitest';
import { MalformedBodyError, ok, withErrorHandling } from './errors';

describe('withErrorHandling', () => {
  it('maps MalformedBodyError to 400 ValidationError', async () => {
    const res = await withErrorHandling(async () => { throw new MalformedBodyError(); });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'ValidationError', message: 'Malformed JSON body' });
  });

  it('does not emit CORS headers (API Gateway owns them)', () => {
    const res = ok(200, {});
    expect(Object.keys(res.headers)).toEqual(['Content-Type']);
  });
});
