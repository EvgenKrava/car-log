import { ZodError } from 'zod';
import { CarNotFoundError, CapExceededError, EventNotFoundError, ProofNotFoundError, ReminderNotFoundError, ExtractionFailedError, QuotaExceededError } from '@carlog/domain';
import { LlmUnavailableError } from './llm-errors';
import { TranscribeUnavailableError } from './transcribe-errors';

// CORS is configured on the HTTP API itself; API Gateway adds those headers and ignores
// any the integration returns, so only the content type is set here.
const HEADERS = { 'Content-Type': 'application/json' };

// Thrown by the handler when the request body is not valid JSON.
export class MalformedBodyError extends Error {
  constructor() { super('Malformed JSON body'); this.name = 'MalformedBodyError'; }
}

export type ApiResult = { statusCode: number; headers: Record<string, string>; body: string };

export function ok(statusCode: number, payload: unknown): ApiResult {
  return { statusCode, headers: HEADERS, body: JSON.stringify(payload ?? null) };
}

export async function withErrorHandling(fn: () => Promise<ApiResult>): Promise<ApiResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof MalformedBodyError) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'ValidationError', message: err.message }) };
    }
    if (err instanceof ZodError) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'ValidationError', issues: err.issues }) };
    }
    if (err instanceof CarNotFoundError) {
      return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'NotFound', message: err.message }) };
    }
    if (err instanceof CapExceededError) {
      return { statusCode: 409, headers: HEADERS, body: JSON.stringify({ error: 'CapExceeded', message: err.message }) };
    }
    if (err instanceof EventNotFoundError || err instanceof ProofNotFoundError || err instanceof ReminderNotFoundError) {
      return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'NotFound', message: err.message }) };
    }
    if (err instanceof ExtractionFailedError) {
      return { statusCode: 422, headers: HEADERS, body: JSON.stringify({ error: 'ExtractionFailed', message: err.message }) };
    }
    if (err instanceof LlmUnavailableError) {
      return { statusCode: 503, headers: HEADERS, body: JSON.stringify({ error: 'LlmUnavailable', message: err.message }) };
    }
    if (err instanceof QuotaExceededError) {
      return { statusCode: 429, headers: HEADERS, body: JSON.stringify({ error: 'QuotaExceeded', kind: err.kind, resetsAt: err.resetsAt }) };
    }
    if (err instanceof TranscribeUnavailableError) {
      return { statusCode: 503, headers: HEADERS, body: JSON.stringify({ error: 'TranscribeUnavailable', message: err.message }) };
    }
    console.error('Unhandled error', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'InternalError' }) };
  }
}
