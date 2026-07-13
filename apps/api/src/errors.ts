import { ZodError } from 'zod';
import { CarNotFoundError } from '@carlog/domain';

export class NotFoundError extends Error {}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Content-Type': 'application/json',
};

export type ApiResult = { statusCode: number; headers: Record<string, string>; body: string };

export function ok(statusCode: number, payload: unknown): ApiResult {
  return { statusCode, headers: CORS, body: JSON.stringify(payload ?? null) };
}

export async function withErrorHandling(fn: () => Promise<ApiResult>): Promise<ApiResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ZodError) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'ValidationError', issues: err.issues }) };
    }
    if (err instanceof CarNotFoundError || err instanceof NotFoundError) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'NotFound', message: err.message }) };
    }
    console.error('Unhandled error', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'InternalError' }) };
  }
}
