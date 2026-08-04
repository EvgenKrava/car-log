import type { Event, EventCategory } from '@carlog/contracts';

// Read-tool bounds: the results re-enter the model prompt, so keep them small.
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;

export type SearchEventsInput = {
  category?: EventCategory;
  from?: string; // YYYY-MM-DD, inclusive
  to?: string;   // YYYY-MM-DD, inclusive
  text?: string;
  limit?: number;
};

// Every free-text field of an event, flattened for case-insensitive matching.
const haystack = (e: Event): string => [
  e.title, e.notes,
  ...e.works.flatMap((w) => [
    w.description,
    ...w.parts.flatMap((p) => [p.name, p.brand, p.partNumber, p.notes]),
  ]),
].filter(Boolean).join(' ').toLowerCase();

// ISO dates compare correctly as strings, so the range check needs no Date parsing.
const matches = (e: Event, input: SearchEventsInput): boolean => {
  if (input.category !== undefined && e.category !== input.category) return false;
  if (input.from !== undefined && e.date < input.from) return false;
  if (input.to !== undefined && e.date > input.to) return false;
  const text = input.text?.trim().toLowerCase();
  if (text !== undefined && text !== '' && !haystack(e).includes(text)) return false;
  return true;
};

// Pure query over the car's FULL timeline — this is what lets the chat reach past the
// MAX_CONTEXT_EVENTS window baked into the system prompt.
export function searchEvents(events: Event[], input: SearchEventsInput): Event[] {
  const limit = Math.min(Math.max(1, input.limit ?? SEARCH_DEFAULT_LIMIT), SEARCH_MAX_LIMIT);
  return events
    .filter((e) => matches(e, input))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) // newest first
    .slice(0, limit);
}

export type SumSpendInput = { category?: EventCategory; from?: string; to?: string };
export type SpendTotal = { currency: string; total: number };

// Totals are per-currency: the timeline can mix UAH and USD, and summing across them
// would invent an exchange rate the app does not have.
export function sumSpend(
  events: Event[], input: SumSpendInput,
): { totals: SpendTotal[]; count: number } {
  const matched = events.filter((e) => matches(e, input));
  const byCurrency = new Map<string, number>();
  for (const e of matched) {
    byCurrency.set(e.currency, (byCurrency.get(e.currency) ?? 0) + e.cost);
  }
  const totals = [...byCurrency.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  return { totals, count: matched.length };
}