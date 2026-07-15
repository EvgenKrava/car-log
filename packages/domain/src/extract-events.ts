import { CandidateEventSchema, type CandidateEvent } from '@carlog/contracts';
import type { LlmProvider, ExtractionContext } from './llm-provider';

export class ExtractionFailedError extends Error {
  constructor(message = 'Could not extract events from the provided text') {
    super(message);
    this.name = 'ExtractionFailedError';
  }
}

const MAX_EVENTS = 50;

// Pull an array of candidate-event-shaped objects out of the model's raw output.
// Accepts `{ events: [...] }` or a bare `[...]`. Returns null when there is no array
// at all (a shape failure that warrants a retry).
function extractArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray((raw as { events?: unknown }).events)) {
    return (raw as { events: unknown[] }).events;
  }
  return null;
}

function validate(raw: unknown): CandidateEvent[] | null {
  const arr = extractArray(raw);
  if (arr === null) return null; // shapeless → caller retries
  const valid: CandidateEvent[] = [];
  for (const item of arr) {
    const parsed = CandidateEventSchema.safeParse(item);
    if (parsed.success) valid.push(parsed.data);
    if (valid.length >= MAX_EVENTS) break;
  }
  return valid;
}

// Shared: run a provider call, validate, retry ONCE on shapeless output, else throw.
async function runWithRetry(call: () => Promise<unknown>): Promise<CandidateEvent[]> {
  const first = validate(await call());
  if (first !== null) return first;
  const second = validate(await call());
  if (second !== null) return second;
  throw new ExtractionFailedError();
}

export async function extractEvents(
  text: string,
  provider: LlmProvider,
  ctx: ExtractionContext,
): Promise<CandidateEvent[]> {
  return runWithRetry(() => provider.extractEvents(text, ctx));
}

export async function extractEventsFromDocument(
  base64: string,
  mediaType: string,
  provider: LlmProvider,
  ctx: ExtractionContext,
): Promise<CandidateEvent[]> {
  return runWithRetry(() => provider.extractEventsFromDocument(base64, mediaType, ctx));
}
