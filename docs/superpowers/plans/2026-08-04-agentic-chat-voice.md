# Agentic Chat (Tools) + Voice Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the per-car AI chat tools so it can create/update reminders, events, and car details (deletes proposed for user confirmation) and query the full timeline, plus add browser-native voice dictation to the chat composer.

**Architecture:** A bounded synchronous tool loop lives in `packages/domain` (`chatAboutCar`), driven by a new `LlmProvider.chatTurn` port that makes exactly one Bedrock call per round. Tool *execution* is an injected `ChatToolExecutor` port implemented in `apps/api` over the existing repositories — so the domain stays SDK-free and the loop is unit-testable against a fake. Deletes never write during a turn; they persist a `pending` action on the assistant message which the user resolves via two new confirm/decline routes. Voice input is a `useSpeechRecognition` hook over the browser Web Speech API — no backend, no upload.

**Tech Stack:** TypeScript (strict), Zod contracts, Vitest, `@anthropic-ai/bedrock-sdk` (`AnthropicBedrockMantle`), React + Material UI v7, TanStack Query, AWS CDK.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-04-agentic-chat-voice-design.md` is authoritative. Read it before Task 1.
- **Never `any`.** Strict TS. Prefer `type` aliases; `interface` only for service abstractions (repository/executor ports).
- **Zod is the contract source of truth.** Define schemas in `packages/contracts`, derive types with `z.infer`. Never hand-write a type that duplicates a schema. Tool `inputSchema` (JSON Schema) only *steers* the model; the executor re-parses every input with the real contract schema before writing.
- **`packages/domain` must not import the AWS SDK** or any infrastructure concern. Lambda handlers stay thin.
- **`ownerId` and `carId` come from the authorized request context on every repository call — never from tool input.**
- **Never leave TODO/stub implementations.** Production-ready code only.
- **Model call budget:** `MAX_MODEL_CALLS = 3`, `TURN_BUDGET_MS = 26_000`, `MIN_ROUND_BUDGET_MS = 8_000`. API Gateway hard-caps the HTTP integration at 30s regardless of the Lambda's 300s timeout.
- **Bedrock model id** stays `process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-opus-4-8'`. Use `thinking: { type: 'adaptive' }` and `output_config: { effort: 'low' }`. Never `budget_tokens`, never `temperature`/`top_p`/`top_k` (all 400 on this model).
- **Bedrock tool-loop contract:** append the assistant's **full** content verbatim each round (thinking blocks must be echoed back unchanged); return **all** tool results for one assistant turn in a **single** user message.
- **Commits:** conventional commits. **Never** add `Co-Authored-By` or "Generated with" trailers.
- **Gates:** `pnpm turbo run build lint typecheck test` must pass before the final commit of each task.
- **AWS:** profile `yevhenii`, region `us-east-1`. Do **not** run `update-user-pool-client` (it previously wiped prod Google login).
- **i18n:** every user-visible string gets a key in both `apps/web/src/i18n/locales/en/chat.json` and `.../uk/chat.json`.

---

## File Structure

**`packages/contracts/src/chat.ts`** (modify) — `ChatActionSchema` + friends; `actions` on `StoredChatMessageSchema`/`ChatMessageViewSchema`.

**`packages/domain/`**
- `llm-provider.ts` (modify) — `chatTurn` replaces `chat`; `ChatToolCall`, `ChatTurnResult`, `ChatToolDefinition`, `ChatTurnEntry`.
- `chat-tools.ts` (create) — the 9 tool definitions (name + description + JSON Schema) and the `ChatToolExecutor` port. One file: the definitions and the port they're executed through change together.
- `event-queries.ts` (create) — pure `searchEvents` / `sumSpend` over `Event[]`.
- `chat-about-car.ts` (modify) — the bounded loop.

**`apps/api/src/`**
- `chat-tool-executor.ts` (create) — `DomainChatToolExecutor`: Zod re-parse → domain use-case → repository. Owns the partial-merge logic.
- `event-delete.ts` (create) — the proof-cascade delete, extracted from `event-routes.ts` so the confirm path and `DELETE /events/{id}` share one implementation.
- `chat-session-routes.ts` (modify) — wire the executor; add confirm/decline routes.
- `bedrock-llm-provider.ts` (modify) — `chatTurn`; delete the dead `CHAT_TOOLS` guard.
- `in-memory-llm-provider.ts` (modify) — satisfy the new port.

**`apps/web/src/`**
- `lib/useSpeechRecognition.ts` (create) — the hook + its own minimal Web Speech types.
- `components/chat/ChatActions.tsx` (create) — action list + pending confirm card.
- `components/chat/ChatBubble.tsx` (modify) — render `<ChatActions>`.
- `components/chat/VoiceComposerButton.tsx` (create) — the mic↔send swap slot.
- `routes/ChatConversation.tsx` (modify) — use the voice button.
- `api-client.ts`, `queries.ts` (modify) — confirm/decline.

**`infrastructure/cdk/lib/carlog-stack.ts`** (modify) — two action routes.

---

### Task 1: Contracts — chat actions

**Files:**
- Modify: `packages/contracts/src/chat.ts`
- Test: `packages/contracts/src/chat.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ChatActionKindSchema`, `ChatActionStatusSchema`, `PendingDeleteSchema`, `ChatActionSchema`, and types `ChatActionKind`, `ChatActionStatus`, `PendingDelete`, `ChatAction`. `StoredChatMessageSchema` and `ChatMessageViewSchema` both gain `actions: ChatAction[]` (defaulting to `[]`).

- [ ] **Step 1: Write the failing test**

Append to `packages/contracts/src/chat.test.ts`:

```ts
describe('ChatActionSchema', () => {
  it('accepts a completed write action', () => {
    const parsed = ChatActionSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'create_reminder',
      status: 'done',
      summary: 'Oil change — due at 259500 km',
      entityId: '22222222-2222-4222-8222-222222222222',
    });
    expect(parsed.kind).toBe('create_reminder');
    expect(parsed.pending).toBeUndefined();
  });

  it('accepts a pending delete carrying its target', () => {
    const parsed = ChatActionSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'delete_reminder',
      status: 'pending',
      summary: 'Delete reminder "Oil change"',
      pending: { target: 'reminder', entityId: '22222222-2222-4222-8222-222222222222' },
    });
    expect(parsed.pending?.target).toBe('reminder');
  });

  it('rejects an unknown kind and an unknown status', () => {
    const base = { id: '11111111-1111-4111-8111-111111111111', summary: 'x' };
    expect(() => ChatActionSchema.parse({ ...base, kind: 'drop_table', status: 'done' })).toThrow();
    expect(() => ChatActionSchema.parse({ ...base, kind: 'create_event', status: 'maybe' })).toThrow();
  });
});

describe('StoredChatMessageSchema actions', () => {
  it('defaults actions to [] so already-stored messages stay parseable', () => {
    const parsed = StoredChatMessageSchema.parse({
      role: 'assistant', content: 'hi', createdAt: '2026-08-04T10:00:00.000Z',
    });
    expect(parsed.actions).toEqual([]);
  });

  it('caps actions at 10', () => {
    const action = {
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'create_reminder', status: 'done', summary: 's',
    };
    expect(() => StoredChatMessageSchema.parse({
      role: 'assistant', content: 'hi', createdAt: '2026-08-04T10:00:00.000Z',
      actions: Array.from({ length: 11 }, () => action),
    })).toThrow();
  });
});
```

Add `ChatActionSchema` and `StoredChatMessageSchema` to the file's existing import from `./chat` (check the top of the test file — it already imports several chat schemas; extend that list rather than adding a second import statement).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/contracts test src/chat.test.ts`
Expected: FAIL — `ChatActionSchema` is not exported.

- [ ] **Step 3: Write the schemas**

In `packages/contracts/src/chat.ts`, insert **above** `StoredChatMessageSchema`:

```ts
// A side effect the assistant performed (or proposed) during a turn. Persisted on the
// assistant message so a reload never loses a pending confirmation.
export const ChatActionKindSchema = z.enum([
  'create_reminder', 'update_reminder', 'delete_reminder',
  'create_event', 'update_event', 'delete_event', 'update_car',
]);

export const ChatActionStatusSchema = z.enum(['done', 'pending', 'declined', 'failed']);

// What a pending (unconfirmed) delete would remove, once the owner confirms.
export const PendingDeleteSchema = z.object({
  target: z.enum(['reminder', 'event']),
  entityId: z.string().uuid(),
});

export const ChatActionSchema = z.object({
  id: z.string().uuid(),
  kind: ChatActionKindSchema,
  status: ChatActionStatusSchema,
  // Built by the executor from the entity's own stored fields — the same untranslated
  // data the History/Reminders tabs show. The UI localizes only the labels around it.
  summary: z.string().max(200),
  entityId: z.string().uuid().optional(),
  pending: PendingDeleteSchema.optional(),
});
```

Then extend both message schemas. `StoredChatMessageSchema` becomes:

```ts
export const StoredChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(4000),
  attachments: z.array(AttachmentRefSchema).max(4).default([]),
  // .default([]) keeps sessions written before this feature parseable — no migration.
  actions: z.array(ChatActionSchema).max(10).default([]),
  createdAt: z.string().datetime(),
});
```

`ChatMessageViewSchema` already `.extend`s from it, so it inherits `actions`; leave its `attachments` override as-is.

Add to the type exports at the bottom:

```ts
export type ChatActionKind = z.infer<typeof ChatActionKindSchema>;
export type ChatActionStatus = z.infer<typeof ChatActionStatusSchema>;
export type PendingDelete = z.infer<typeof PendingDeleteSchema>;
export type ChatAction = z.infer<typeof ChatActionSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @carlog/contracts test src/chat.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck the workspace**

Run: `pnpm turbo run typecheck`
Expected: PASS. (`actions` is defaulted, so no existing construction site breaks.)

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/chat.ts packages/contracts/src/chat.test.ts
git commit -m "feat(contracts): chat action schema for assistant side effects"
```

---

### Task 2: Domain — pure timeline queries

**Files:**
- Create: `packages/domain/src/event-queries.ts`
- Create: `packages/domain/src/event-queries.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `Event`, `EventCategory` from `@carlog/contracts`.
- Produces:
  - `type SearchEventsInput = { category?: EventCategory; from?: string; to?: string; text?: string; limit?: number }`
  - `searchEvents(events: Event[], input: SearchEventsInput): Event[]` — newest first, default limit 20, max 50.
  - `type SumSpendInput = { category?: EventCategory; from?: string; to?: string }`
  - `type SpendTotal = { currency: string; total: number }`
  - `sumSpend(events: Event[], input: SumSpendInput): { totals: SpendTotal[]; count: number }`

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/event-queries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Event } from '@carlog/contracts';
import { searchEvents, sumSpend, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT } from './event-queries';

const ev = (over: Partial<Event> & { id: string; date: string }): Event => ({
  carId: 'car-1', ownerId: 'owner-1', category: 'other', mileage: 0, cost: 0,
  currency: 'UAH', title: undefined, notes: undefined, works: [],
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  ...over,
});

const timeline: Event[] = [
  ev({ id: 'a', date: '2019-11-26', category: 'inspection', cost: 500, title: 'Antifreeze check' }),
  ev({ id: 'b', date: '2023-06-01', category: 'oil_change', cost: 1200, title: 'Oil and filter' }),
  ev({ id: 'c', date: '2024-02-17', category: 'brakes', cost: 3000, title: 'Front pads' }),
  ev({ id: 'd', date: '2025-01-10', category: 'oil_change', cost: 60, currency: 'USD', title: 'Oil top-up' }),
];

describe('searchEvents', () => {
  it('returns everything newest-first when no filter is given', () => {
    expect(searchEvents(timeline, {}).map((e) => e.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('filters by category', () => {
    expect(searchEvents(timeline, { category: 'oil_change' }).map((e) => e.id)).toEqual(['d', 'b']);
  });

  it('filters by an inclusive date range', () => {
    expect(searchEvents(timeline, { from: '2023-06-01', to: '2024-02-17' }).map((e) => e.id))
      .toEqual(['c', 'b']);
  });

  it('matches text case-insensitively across title, notes, works and parts', () => {
    const rich = ev({
      id: 'e', date: '2026-01-01', notes: 'Replaced the STABILIZER links',
      works: [{ description: 'Suspension', parts: [{ name: 'Bilstein strut', quantity: 2 }] }],
    });
    const all = [...timeline, rich];
    expect(searchEvents(all, { text: 'stabilizer' }).map((e) => e.id)).toEqual(['e']);
    expect(searchEvents(all, { text: 'bilstein' }).map((e) => e.id)).toEqual(['e']);
    expect(searchEvents(all, { text: 'front pads' }).map((e) => e.id)).toEqual(['c']);
  });

  it('applies the default limit and clamps an oversized one', () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      ev({ id: `x${i}`, date: `2020-01-${String((i % 28) + 1).padStart(2, '0')}` }));
    expect(searchEvents(many, {})).toHaveLength(SEARCH_DEFAULT_LIMIT);
    expect(searchEvents(many, { limit: 999 })).toHaveLength(SEARCH_MAX_LIMIT);
    expect(searchEvents(many, { limit: 3 })).toHaveLength(3);
  });

  it('returns [] for an empty timeline', () => {
    expect(searchEvents([], { category: 'brakes' })).toEqual([]);
  });
});

describe('sumSpend', () => {
  it('groups totals per currency and counts matches', () => {
    expect(sumSpend(timeline, {})).toEqual({
      totals: [{ currency: 'UAH', total: 4700 }, { currency: 'USD', total: 60 }],
      count: 4,
    });
  });

  it('respects the category filter', () => {
    expect(sumSpend(timeline, { category: 'oil_change' })).toEqual({
      totals: [{ currency: 'UAH', total: 1200 }, { currency: 'USD', total: 60 }],
      count: 2,
    });
  });

  it('respects the date range', () => {
    expect(sumSpend(timeline, { from: '2024-01-01' })).toEqual({
      totals: [{ currency: 'UAH', total: 3000 }, { currency: 'USD', total: 60 }],
      count: 2,
    });
  });

  it('returns no totals when nothing matches', () => {
    expect(sumSpend(timeline, { category: 'tires' })).toEqual({ totals: [], count: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/domain test src/event-queries.test.ts`
Expected: FAIL — cannot resolve `./event-queries`.

- [ ] **Step 3: Write the implementation**

Create `packages/domain/src/event-queries.ts`:

```ts
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
```

- [ ] **Step 4: Export from the domain barrel**

In `packages/domain/src/index.ts`, add after the `export * from './event-repository';` line:

```ts
export * from './event-queries';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @carlog/domain test src/event-queries.test.ts`
Expected: PASS (all 10 cases).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/event-queries.ts packages/domain/src/event-queries.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): pure searchEvents and sumSpend timeline queries"
```

---

### Task 3: Domain — tool definitions and the executor port

**Files:**
- Create: `packages/domain/src/chat-tools.ts`
- Create: `packages/domain/src/chat-tools.test.ts`
- Modify: `packages/domain/src/llm-provider.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type ChatToolCall = { id: string; name: string; input: unknown }`
  - `type ChatTurnResult = { text: string; toolCalls: ChatToolCall[]; raw: unknown }`
  - `type ChatToolDefinition = { name: string; description: string; inputSchema: Record<string, unknown> }`
  - `type ChatTurnEntry = { role: 'user'; content: string } | { role: 'assistant'; raw: unknown } | { role: 'tool_results'; results: ChatToolResult[] }`
  - `type ChatToolResult = { id: string; content: string; isError: boolean }`
  - `type ChatToolOutcome = { content: string; isError: boolean; action?: ChatAction }`
  - `interface ChatToolExecutor { execute(call: ChatToolCall): Promise<ChatToolOutcome> }`
  - `CHAT_TOOLS: ChatToolDefinition[]` (9 entries), `CHAT_TOOL_NAMES: readonly string[]`
  - `LlmProvider.chatTurn(transcript, context, attachments, tools)` replaces `LlmProvider.chat`.

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/chat-tools.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CHAT_TOOLS, CHAT_TOOL_NAMES } from './chat-tools';

describe('CHAT_TOOLS', () => {
  it('exposes exactly the nine designed tools', () => {
    expect([...CHAT_TOOL_NAMES].sort()).toEqual([
      'create_event', 'create_reminder', 'delete_event', 'delete_reminder',
      'search_events', 'sum_spend', 'update_car', 'update_event', 'update_reminder',
    ]);
    expect(CHAT_TOOLS).toHaveLength(9);
  });

  it('gives every tool a name, a prescriptive description and an object schema', () => {
    for (const tool of CHAT_TOOLS) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      // Descriptions must say WHEN to call, not just what the tool does.
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema).toHaveProperty('properties');
    }
  });

  it('has unique names', () => {
    expect(new Set(CHAT_TOOL_NAMES).size).toBe(CHAT_TOOL_NAMES.length);
  });

  it('requires an id on every update and delete tool', () => {
    for (const name of ['update_reminder', 'delete_reminder', 'update_event', 'delete_event']) {
      const tool = CHAT_TOOLS.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.inputSchema.required, name).toContain('id');
    }
  });

  it('never asks the model for an owner or car identifier', () => {
    const json = JSON.stringify(CHAT_TOOLS);
    expect(json).not.toContain('ownerId');
    expect(json).not.toContain('carId');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/domain test src/chat-tools.test.ts`
Expected: FAIL — cannot resolve `./chat-tools`.

- [ ] **Step 3: Write the tool definitions**

Create `packages/domain/src/chat-tools.ts`:

```ts
import type { ChatAction } from '@carlog/contracts';

// One tool call the model asked for. `input` is unknown by design: the API-side executor
// re-parses it with the authoritative Zod contract before any write.
export type ChatToolCall = { id: string; name: string; input: unknown };

// What one executed tool contributes back to the loop. `action` is present only for
// side effects (writes and proposed deletes) — read tools produce none.
export type ChatToolOutcome = { content: string; isError: boolean; action?: ChatAction };

// The port the domain loop calls to run a tool. Implemented in apps/api over the
// repositories, so the domain never touches persistence or the AWS SDK.
export interface ChatToolExecutor {
  execute(call: ChatToolCall): Promise<ChatToolOutcome>;
}

// Neutral JSON-Schema shape handed to the provider. It only STEERS the model toward the
// right input; the contract schema in the executor is the authoritative validator (same
// split as EXTRACT_TOOL in the Bedrock adapter).
export type ChatToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const CATEGORY = {
  type: 'string',
  enum: ['oil_change', 'tires', 'brakes', 'inspection', 'repair', 'other'],
  description: 'Maintenance category. Use "other" when unsure.',
};

const DATE = { type: 'string', description: 'Date as YYYY-MM-DD.' };

const REMINDER_FIELDS = {
  title: { type: 'string', description: 'Short label, e.g. "Engine oil + filters".' },
  category: CATEGORY,
  dueDate: { ...DATE, description: 'Calendar due date, YYYY-MM-DD. Set this, dueMileage, or both.' },
  dueMileage: { type: 'integer', description: 'Odometer target in km. Set this, dueDate, or both.' },
  repeatMonths: { type: 'integer', description: 'Repeat interval in months. Requires dueDate.' },
  repeatKm: { type: 'integer', description: 'Repeat interval in km (min 100). Requires dueMileage.' },
  notes: { type: 'string' },
};

const PARTS = {
  type: 'array',
  description: 'Physical parts, fluids, and materials used for this work.',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Part name, e.g. "Oil filter".' },
      brand: { type: 'string' },
      partNumber: { type: 'string' },
      quantity: { type: 'integer', description: 'Quantity, at least 1.' },
      notes: { type: 'string' },
    },
    required: ['name', 'quantity'],
  },
};

const WORKS = {
  type: 'array',
  description: 'One entry per service performed. Parts belong nested inside their work, never in notes.',
  items: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'The service performed, e.g. "Oil change".' },
      parts: PARTS,
    },
    required: ['description'],
  },
};

const EVENT_FIELDS = {
  date: { ...DATE, description: 'When the service happened, YYYY-MM-DD.' },
  mileage: { type: 'integer', description: 'Odometer reading in km at the time of service.' },
  cost: { type: 'number', description: 'Total cost. Use 0 when unknown.' },
  currency: { type: 'string', description: 'Currency code. Defaults to UAH.' },
  category: CATEGORY,
  title: { type: 'string' },
  notes: { type: 'string' },
  works: WORKS,
};

// The tools the chat model may call. Descriptions state WHEN to call — recent Opus models
// reach for tools conservatively, and trigger conditions measurably lift call rate.
export const CHAT_TOOLS: ChatToolDefinition[] = [
  {
    name: 'create_reminder',
    description:
      'Create a maintenance reminder for this car. Call this whenever the owner asks to be '
      + 'reminded, to schedule something, or to set up upcoming service. Requires a title, a '
      + 'category, and at least one of dueDate or dueMileage. Do not guess a due target — if '
      + 'neither can be derived from the records, ask the owner instead.',
    inputSchema: {
      type: 'object',
      properties: REMINDER_FIELDS,
      required: ['title', 'category'],
    },
  },
  {
    name: 'update_reminder',
    description:
      'Change an existing reminder. Call this when the owner wants to move a due date, adjust '
      + 'a mileage target, rename a reminder, or change its repeat interval. Only the fields '
      + 'you pass are changed; everything else is preserved. The id must come from the '
      + 'reminders listed in the context.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The reminder id.' }, ...REMINDER_FIELDS },
      required: ['id'],
    },
  },
  {
    name: 'delete_reminder',
    description:
      'Propose deleting a reminder. Call this when the owner asks to remove or cancel one. '
      + 'This does NOT delete it immediately — the owner must confirm in the chat first. Tell '
      + 'them it is awaiting their confirmation and do not call this tool again for the same id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The reminder id.' } },
      required: ['id'],
    },
  },
  {
    name: 'create_event',
    description:
      'Log a completed service into the car timeline. Call this when the owner says they had '
      + 'work done, replaced a part, or paid for maintenance. Requires a date, mileage, and '
      + 'category. Never invent a mileage, date, cost, or part number — ask if it is missing '
      + 'and cannot be derived from the records.',
    inputSchema: {
      type: 'object',
      properties: EVENT_FIELDS,
      required: ['date', 'mileage', 'category'],
    },
  },
  {
    name: 'update_event',
    description:
      'Correct an existing timeline entry. Call this when the owner says a recorded date, '
      + 'mileage, cost, or description is wrong. Only the fields you pass are changed. Passing '
      + 'works replaces the whole works list, so include every work you want to keep.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The event id.' }, ...EVENT_FIELDS },
      required: ['id'],
    },
  },
  {
    name: 'delete_event',
    description:
      'Propose deleting a timeline entry. Call this when the owner asks to remove a record. '
      + 'This does NOT delete it immediately — the owner must confirm in the chat first, and '
      + 'confirming also removes the entry attachments. Say it is awaiting their confirmation.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The event id.' } },
      required: ['id'],
    },
  },
  {
    name: 'update_car',
    description:
      'Update this car own details. Call this when the owner reports a new odometer reading, '
      + 'or corrects the nickname, licence plate, VIN, engine volume, fuel type, make, model, '
      + 'or year. Only the fields you pass are changed. Say what you changed.',
    inputSchema: {
      type: 'object',
      properties: {
        mileage: { type: 'integer', description: 'Current odometer reading in km.' },
        nickname: { type: 'string' },
        licensePlate: { type: 'string' },
        vin: { type: 'string' },
        engineVolume: { type: 'number', description: 'Displacement in liters, e.g. 1.6.' },
        fuelType: {
          type: 'string',
          enum: ['petrol', 'diesel', 'electric', 'hybrid', 'lpg', 'other'],
        },
        make: { type: 'string' },
        model: { type: 'string' },
        year: { type: 'integer' },
      },
    },
  },
  {
    name: 'search_events',
    description:
      'Search this car FULL service history. Call this whenever the answer may depend on '
      + 'records older than the recent ones already shown in the context — for example a '
      + 'question about the first time something was done, or about a specific part across '
      + 'the whole history. Returns matching entries, newest first.',
    inputSchema: {
      type: 'object',
      properties: {
        category: CATEGORY,
        from: { ...DATE, description: 'Only entries on or after this date, YYYY-MM-DD.' },
        to: { ...DATE, description: 'Only entries on or before this date, YYYY-MM-DD.' },
        text: { type: 'string', description: 'Free text matched against titles, notes, works and parts.' },
        limit: { type: 'integer', description: 'Max entries to return (default 20, max 50).' },
      },
    },
  },
  {
    name: 'sum_spend',
    description:
      'Total what was spent on this car, optionally by category and date range. Call this for '
      + 'any "how much have I spent" question instead of adding costs up yourself, so older '
      + 'records outside the shown context are included. Totals are reported per currency.',
    inputSchema: {
      type: 'object',
      properties: {
        category: CATEGORY,
        from: { ...DATE, description: 'Only entries on or after this date, YYYY-MM-DD.' },
        to: { ...DATE, description: 'Only entries on or before this date, YYYY-MM-DD.' },
      },
    },
  },
];

export const CHAT_TOOL_NAMES: readonly string[] = CHAT_TOOLS.map((t) => t.name);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @carlog/domain test src/chat-tools.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 5: Replace `chat` with `chatTurn` on the provider port**

In `packages/domain/src/llm-provider.ts`, add above the `LlmProvider` interface:

```ts
// One entry per model round, plus the tool results between rounds. The assistant entry
// carries `raw` — the provider's own content blocks, echoed back UNCHANGED on the next
// round (Bedrock rejects modified thinking blocks). The domain forwards it, never reads it.
export type ChatTurnEntry =
  | { role: 'user'; content: string }
  | { role: 'assistant'; raw: unknown }
  | { role: 'tool_results'; results: ChatToolResult[] };

export type ChatToolResult = { id: string; content: string; isError: boolean };

// The outcome of ONE model call in the tool loop. `toolCalls` empty ⇒ the turn is done.
export type ChatTurnResult = { text: string; toolCalls: ChatToolCall[]; raw: unknown };
```

Add the import at the top of the file:

```ts
import type { ChatToolCall, ChatToolDefinition } from './chat-tools';
```

Replace the `chat(...)` member of `LlmProvider` with:

```ts
  // ONE model call in the chat tool loop. `transcript` is the conversation so far plus any
  // prior rounds of this turn; `attachments` are the current turn's decoded files (first
  // round only); `tools` is [] on the final forced-text round. Loop policy lives in the
  // domain use-case, not here.
  chatTurn(
    transcript: ChatTurnEntry[],
    context: CarChatContext,
    attachments: ChatAttachment[],
    tools: ChatToolDefinition[],
  ): Promise<ChatTurnResult>;
```

- [ ] **Step 6: Export from the domain barrel**

In `packages/domain/src/index.ts`, add after the `export * from './llm-provider';` line:

```ts
export * from './chat-tools';
```

- [ ] **Step 7: Verify the domain package's own tests still compile**

Run: `pnpm --filter @carlog/domain test src/chat-tools.test.ts src/event-queries.test.ts`
Expected: PASS. (`chat-about-car.test.ts` and the API package are knowingly broken until Tasks 4–6; do not fix them here.)

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/chat-tools.ts packages/domain/src/chat-tools.test.ts packages/domain/src/llm-provider.ts packages/domain/src/index.ts
git commit -m "feat(domain): chat tool definitions and executor port"
```

---

### Task 4: Domain — the bounded tool loop

**Files:**
- Modify: `packages/domain/src/chat-about-car.ts`
- Modify: `packages/domain/src/chat-about-car.test.ts`

**Interfaces:**
- Consumes: `ChatToolExecutor`, `ChatToolCall`, `ChatToolOutcome`, `CHAT_TOOLS` (Task 3); `ChatTurnEntry`, `ChatTurnResult`, `LlmProvider` (Task 3); `ChatAction` (Task 1).
- Produces:
  - `MAX_MODEL_CALLS = 3`, `TURN_BUDGET_MS = 26_000`, `MIN_ROUND_BUDGET_MS = 8_000`
  - `type ChatTurnOutput = { reply: string; actions: ChatAction[] }`
  - `type ChatAboutCarDeps = { now?: () => number }`
  - `chatAboutCar(messages: ChatMessage[], llm: LlmProvider, context: CarChatContext, executor: ChatToolExecutor, attachments?: ChatAttachment[], deps?: ChatAboutCarDeps): Promise<ChatTurnOutput>`
  - `buildCarChatContext` unchanged.

- [ ] **Step 1: Write the failing tests**

In `packages/domain/src/chat-about-car.test.ts`, **replace** the whole `describe('chatAboutCar', …)` block (keep the fixtures and the `buildCarChatContext` block above it) with:

```ts
describe('chatAboutCar', () => {
  const ctx = buildCarChatContext(car, events, reminders);
  const userTurn: ChatMessage[] = [{ role: 'user', content: 'Remind me to change the oil' }];

  // A provider that replays a scripted ChatTurnResult per call and records the tools
  // it was offered on each round.
  const scripted = (rounds: ChatTurnResult[]) => {
    const offered: number[] = [];
    const llm: LlmProvider = {
      extractEvents: vi.fn(),
      extractEventsFromDocument: vi.fn(),
      chatTurn: vi.fn(async (_t, _c, _a, tools) => {
        offered.push(tools.length);
        const next = rounds.shift();
        if (!next) throw new Error('provider called more times than scripted');
        return next;
      }),
    };
    return { llm, offered };
  };

  const text = (t: string): ChatTurnResult => ({ text: t, toolCalls: [], raw: { t } });
  const call = (id: string, name: string): ChatTurnResult =>
    ({ text: '', toolCalls: [{ id, name, input: {} }], raw: { id } });

  const action: ChatAction = {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'create_reminder', status: 'done', summary: 'Oil change — 259500 km',
  };

  const executor = (outcome: ChatToolOutcome): ChatToolExecutor & { calls: ChatToolCall[] } => {
    const calls: ChatToolCall[] = [];
    return { calls, execute: async (c) => { calls.push(c); return outcome; } };
  };

  it('returns the reply from a single round with no tool calls', async () => {
    const { llm, offered } = scripted([text('You are due for oil soon.')]);
    const exec = executor({ content: 'x', isError: false });
    await expect(chatAboutCar(userTurn, llm, ctx, exec)).resolves.toEqual({
      reply: 'You are due for oil soon.', actions: [],
    });
    expect(exec.calls).toEqual([]);
    expect(offered).toEqual([CHAT_TOOLS.length]); // tools offered on the first round
  });

  it('executes a tool call, then returns the follow-up text and the action', async () => {
    const { llm } = scripted([call('t1', 'create_reminder'), text('Done — reminder created.')]);
    const exec = executor({ content: 'Created reminder', isError: false, action });
    const out = await chatAboutCar(userTurn, llm, ctx, exec);
    expect(out.reply).toBe('Done — reminder created.');
    expect(out.actions).toEqual([action]);
    expect(exec.calls.map((c) => c.name)).toEqual(['create_reminder']);
  });

  it('joins narration text from every round', async () => {
    const rounds: ChatTurnResult[] = [
      { text: 'Sure, creating that now.', toolCalls: [{ id: 't1', name: 'create_reminder', input: {} }], raw: {} },
      text('Created.'),
    ];
    const { llm } = scripted(rounds);
    const out = await chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false }));
    expect(out.reply).toBe('Sure, creating that now.\n\nCreated.');
  });

  it('sends all results of one round back as a single tool_results entry', async () => {
    const two: ChatTurnResult = {
      text: '', raw: {},
      toolCalls: [
        { id: 't1', name: 'create_reminder', input: {} },
        { id: 't2', name: 'create_reminder', input: {} },
      ],
    };
    const { llm } = scripted([two, text('Both done.')]);
    await chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false }));
    const secondCallTranscript = vi.mocked(llm.chatTurn).mock.calls[1]![0];
    const isResults = (e: ChatTurnEntry): e is Extract<ChatTurnEntry, { role: 'tool_results' }> =>
      e.role === 'tool_results';
    const resultEntries = secondCallTranscript.filter(isResults);
    expect(resultEntries).toHaveLength(1);
    expect(resultEntries[0]!.results).toHaveLength(2);
  });

  it('echoes the provider raw assistant content back unchanged', async () => {
    const raw = { blocks: ['thinking-sentinel'] };
    const { llm } = scripted([
      { text: '', toolCalls: [{ id: 't1', name: 'create_reminder', input: {} }], raw },
      text('ok'),
    ]);
    await chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false }));
    const secondCallTranscript = vi.mocked(llm.chatTurn).mock.calls[1]![0];
    expect(secondCallTranscript).toContainEqual({ role: 'assistant', raw });
  });

  it('stops offering tools on the last permitted model call', async () => {
    const keepCalling = () => call('t', 'create_reminder');
    const { llm, offered } = scripted([keepCalling(), keepCalling(), text('Final answer.')]);
    const out = await chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false }));
    expect(out.reply).toBe('Final answer.');
    expect(llm.chatTurn).toHaveBeenCalledTimes(MAX_MODEL_CALLS);
    expect(offered).toEqual([CHAT_TOOLS.length, CHAT_TOOLS.length, 0]); // forced text last
  });

  it('forces the final text round early when the clock budget runs low', async () => {
    // now() is read once for startedAt, then once per round. Round 0 has the full budget;
    // by round 1 only TURN_BUDGET_MS - 20000 = 6s remains, under MIN_ROUND_BUDGET_MS.
    const clock = [0, 0, 20_000];
    expect(TURN_BUDGET_MS - 20_000).toBeLessThan(MIN_ROUND_BUDGET_MS);
    const now = () => clock.shift() ?? 20_000;
    const { llm, offered } = scripted([call('t1', 'create_reminder'), text('Ran out of time, here is what I know.')]);
    const out = await chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false }), [], { now });
    expect(out.reply).toBe('Ran out of time, here is what I know.');
    expect(offered).toEqual([CHAT_TOOLS.length, 0]); // second round had no tools
  });

  it('sends attachments on the first round only', async () => {
    const { llm } = scripted([call('t1', 'create_reminder'), text('ok')]);
    const attachments = [{ base64: 'AAA', mediaType: 'image/png' }];
    await chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false }), attachments);
    expect(vi.mocked(llm.chatTurn).mock.calls[0]![2]).toEqual(attachments);
    expect(vi.mocked(llm.chatTurn).mock.calls[1]![2]).toEqual([]);
  });

  it('keeps a failed tool from failing the turn', async () => {
    const { llm } = scripted([call('t1', 'create_reminder'), text('That did not work.')]);
    const exec: ChatToolExecutor = { execute: async () => ({ content: 'Invalid input', isError: true }) };
    const out = await chatAboutCar(userTurn, llm, ctx, exec);
    expect(out.reply).toBe('That did not work.');
    expect(out.actions).toEqual([]);
  });

  it('reports committed actions when a later round fails, instead of losing them', async () => {
    const boom = new Error('bedrock exploded');
    const llm: LlmProvider = {
      extractEvents: vi.fn(),
      extractEventsFromDocument: vi.fn(),
      chatTurn: vi.fn()
        .mockResolvedValueOnce(call('t1', 'create_reminder'))
        .mockRejectedValueOnce(boom),
    };
    const err = await chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false, action }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChatTurnInterruptedError);
    expect((err as ChatTurnInterruptedError).actions).toEqual([action]);
    expect((err as ChatTurnInterruptedError).cause).toBe(boom);
  });

  it('lets a first-round failure surface unchanged (nothing was committed)', async () => {
    const boom = new Error('bedrock exploded');
    const llm: LlmProvider = {
      extractEvents: vi.fn(),
      extractEventsFromDocument: vi.fn(),
      chatTurn: vi.fn(async () => { throw boom; }),
    };
    await expect(chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false })))
      .rejects.toBe(boom);
  });

  it('falls back to an action summary when the model produced no text', async () => {
    const { llm } = scripted([call('t1', 'create_reminder'), text('')]);
    const out = await chatAboutCar(userTurn, llm, ctx, executor({ content: 'ok', isError: false, action }));
    expect(out.reply).toContain('Oil change — 259500 km');
    expect(out.actions).toEqual([action]);
  });

  it('rejects an empty history', async () => {
    const { llm } = scripted([text('x')]);
    await expect(chatAboutCar([], llm, ctx, executor({ content: 'ok', isError: false }))).rejects.toThrow();
  });

  it('rejects a history not ending in a user turn', async () => {
    const { llm } = scripted([text('x')]);
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    await expect(chatAboutCar(messages, llm, ctx, executor({ content: 'ok', isError: false }))).rejects.toThrow();
  });
});
```

Update the test file's imports to:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Car, Event, Reminder, ChatMessage, ChatAction } from '@carlog/contracts';
import type { LlmProvider, ChatTurnResult, ChatTurnEntry } from './llm-provider';
import type { ChatToolExecutor, ChatToolCall, ChatToolOutcome } from './chat-tools';
import { CHAT_TOOLS } from './chat-tools';
import {
  buildCarChatContext, chatAboutCar, ChatTurnInterruptedError, MAX_CONTEXT_EVENTS,
  MAX_MODEL_CALLS, TURN_BUDGET_MS, MIN_ROUND_BUDGET_MS,
} from './chat-about-car';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @carlog/domain test src/chat-about-car.test.ts`
Expected: FAIL — `MAX_MODEL_CALLS` is not exported and `chatAboutCar` has the old signature.

- [ ] **Step 3: Write the loop**

In `packages/domain/src/chat-about-car.ts`, keep `MAX_CONTEXT_EVENTS` and `buildCarChatContext` exactly as they are. Replace the imports and the `chatAboutCar` function with:

```ts
import type { Car, Event, Reminder, ChatMessage, ChatAction } from '@carlog/contracts';
import type {
  LlmProvider, CarChatContext, ChatAttachment, ChatTurnEntry, ChatToolResult,
} from './llm-provider';
import { CHAT_TOOLS, type ChatToolExecutor, type ChatToolDefinition } from './chat-tools';
```

```ts
// Loop bounds. API Gateway hard-caps the HTTP integration at 30s regardless of the
// Lambda's own timeout, so the turn is bounded by wall-clock as well as round count.
export const MAX_MODEL_CALLS = 3;
export const TURN_BUDGET_MS = 26_000;
export const MIN_ROUND_BUDGET_MS = 8_000;

export type ChatTurnOutput = { reply: string; actions: ChatAction[] };
export type ChatAboutCarDeps = { now?: () => number };

const FALLBACK_REPLY = 'Sorry — I could not produce an answer from this car\'s records.';

// Answer the latest user message, letting the model call tools to read and change this
// car's data. Bounded by MAX_MODEL_CALLS and TURN_BUDGET_MS: when either runs out the
// final call is made with no tools, so the model must answer in text.
export async function chatAboutCar(
  messages: ChatMessage[],
  llm: LlmProvider,
  context: CarChatContext,
  executor: ChatToolExecutor,
  attachments: ChatAttachment[] = [],
  deps: ChatAboutCarDeps = {},
): Promise<ChatTurnOutput> {
  if (messages.length === 0 || messages[messages.length - 1]!.role !== 'user') {
    throw new Error('chat requires a non-empty history ending in a user message');
  }
  const now = deps.now ?? Date.now;
  const startedAt = now();

  const transcript: ChatTurnEntry[] = messages.map((m) => ({ role: 'user', content: m.content }));
  const texts: string[] = [];
  const actions: ChatAction[] = [];

  for (let round = 0; round < MAX_MODEL_CALLS; round += 1) {
    const isLastRound = round === MAX_MODEL_CALLS - 1;
    const remaining = TURN_BUDGET_MS - (now() - startedAt);
    // Offer tools only while there is room for a follow-up call to narrate the result.
    const tools: ChatToolDefinition[] =
      isLastRound || remaining < MIN_ROUND_BUDGET_MS ? [] : CHAT_TOOLS;

    // Bytes go on the first round only — by round 2 the model has already read them, and
    // re-sending them each round would blow the token budget.
    const turnAttachments = round === 0 ? attachments : [];
    const result = await llm.chatTurn(transcript, context, turnAttachments, tools);

    if (result.text.trim() !== '') texts.push(result.text.trim());
    transcript.push({ role: 'assistant', raw: result.raw });

    if (result.toolCalls.length === 0) break;

    // Execute this round's calls concurrently, then return ALL results in ONE entry:
    // splitting them across entries trains the model out of parallel tool use.
    const outcomes = await Promise.all(result.toolCalls.map((call) => executor.execute(call)));
    const results: ChatToolResult[] = outcomes.map((outcome, i) => ({
      id: result.toolCalls[i]!.id,
      content: outcome.content,
      isError: outcome.isError,
    }));
    for (const outcome of outcomes) {
      if (outcome.action) actions.push(outcome.action);
    }
    transcript.push({ role: 'tool_results', results });
  }

  const reply = texts.join('\n\n').trim()
    || actions.map((a) => a.summary).join('\n')
    || FALLBACK_REPLY;
  return { reply, actions };
}

// Thrown when a round fails AFTER earlier rounds already committed writes. Carries what
// was done so the route can persist an assistant message instead of losing real side
// effects behind a 503. `cause` is the provider error.
export class ChatTurnInterruptedError extends Error {
  constructor(readonly actions: ChatAction[], override readonly cause: unknown) {
    super('chat turn interrupted after committing changes');
    this.name = 'ChatTurnInterruptedError';
  }
}
```

Wrap the `llm.chatTurn` call so a mid-turn provider failure does not discard committed
writes. Replace the bare `const result = await llm.chatTurn(...)` line with:

```ts
    let result: ChatTurnResult;
    try {
      result = await llm.chatTurn(transcript, context, turnAttachments, tools);
    } catch (err) {
      // Nothing committed yet ⇒ let the provider error surface as the usual 503.
      if (actions.length === 0) throw err;
      throw new ChatTurnInterruptedError(actions, err);
    }
```

and add `ChatTurnResult` to the `./llm-provider` type import at the top of the file.

- [ ] **Step 4: Widen the barrel export**

`packages/domain/src/index.ts:10` is a **named** export list, so the new symbols must be
added by hand or the API package cannot see them. Replace that line with:

```ts
export {
  chatAboutCar, buildCarChatContext, ChatTurnInterruptedError,
  MAX_CONTEXT_EVENTS, MAX_MODEL_CALLS, TURN_BUDGET_MS, MIN_ROUND_BUDGET_MS,
  type ChatTurnOutput, type ChatAboutCarDeps,
} from './chat-about-car';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @carlog/domain test src/chat-about-car.test.ts`
Expected: PASS (14 `chatAboutCar` cases + the 3 pre-existing `buildCarChatContext` cases).

- [ ] **Step 6: Run the whole domain suite**

Run: `pnpm --filter @carlog/domain test`
Expected: PASS. (`apps/api` is knowingly broken until Task 6.)

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/chat-about-car.ts packages/domain/src/chat-about-car.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): bounded tool loop for car chat"
```

---

### Task 5: Bedrock adapter — `chatTurn`

**Files:**
- Modify: `apps/api/src/bedrock-llm-provider.ts`
- Modify: `apps/api/src/in-memory-llm-provider.ts`

**Interfaces:**
- Consumes: `ChatTurnEntry`, `ChatTurnResult`, `ChatToolDefinition`, `CarChatContext`, `ChatAttachment` (Task 3).
- Produces: `BedrockLlmProvider.chatTurn(...)` and `InMemoryLlmProvider.chatTurn(...)`. `InMemoryLlmProvider`'s constructor gains an optional third parameter `chatRounds?: ChatTurnResult[]` — successive `chatTurn` calls shift from it; when exhausted or absent it returns a plain text result.

- [ ] **Step 1: Update the in-memory provider**

Replace the `chat()` method in `apps/api/src/in-memory-llm-provider.ts` and extend the constructor:

```ts
import type { LlmProvider, ChatTurnResult } from '@carlog/domain';

// Deterministic fake for tests. Configure with the raw output to return, or an Error
// to throw (to exercise the 503 path). The text/context args are irrelevant to a
// fixed-output fake, so the methods ignore them (still satisfies LlmProvider).
// `chatRounds` scripts a tool loop: each chatTurn call shifts the next round off it.
export class InMemoryLlmProvider implements LlmProvider {
  constructor(
    private readonly output: unknown,
    private readonly throwErr?: Error,
    private readonly chatRounds: ChatTurnResult[] = [],
  ) {}
  async extractEvents(): Promise<unknown> {
    if (this.throwErr) throw this.throwErr;
    return this.output;
  }
  async extractEventsFromDocument(): Promise<unknown> {
    if (this.throwErr) throw this.throwErr;
    return this.output;
  }
  async chatTurn(): Promise<ChatTurnResult> {
    if (this.throwErr) throw this.throwErr;
    const next = this.chatRounds.shift();
    return next ?? { text: 'stub chat reply', toolCalls: [], raw: { type: 'stub' } };
  }
}
```

- [ ] **Step 2: Rewrite the Bedrock chat path**

In `apps/api/src/bedrock-llm-provider.ts`:

**(a)** Update the type import to include the new types:

```ts
import type {
  LlmProvider, ExtractionContext, CarChatContext, ChatAttachment,
  ChatTurnEntry, ChatTurnResult, ChatToolDefinition,
} from '@carlog/domain';
```

`ChatMessage` is no longer used by this file — remove it from the `@carlog/contracts` import (leave the import statement out entirely if nothing else is imported from there).

**(b)** Delete the dead extensibility seam — remove the `type ChatTool = {…}` declaration and `const CHAT_TOOLS: ChatTool[] = []` (lines ~119–123) together with their comment block. The registry now lives in `packages/domain/src/chat-tools.ts`.

**(c)** In `chatSystem(ctx)`, change the signature to `chatSystem(ctx: CarChatContext, today: string): string` and replace the opening instruction lines (the first four strings of `lines`) with:

```ts
    'You are CarLog, an assistant for ONE specific vehicle. You can both answer questions',
    'about it and change its records using the provided tools.',
    '',
    `Today is ${today}.`,
    '',
    'RULES:',
    '- When the owner asks you to record, schedule, change, or correct something, USE THE',
    '  TOOLS to do it. Do not just describe what you would do.',
    '- NEVER invent a mileage, date, cost, or part number. If a required field is missing and',
    '  cannot be derived from the records below, ask ONE short question instead of guessing.',
    '- When the owner says "now" or "today", prefer the odometer and date already on record.',
    '- Deletions are proposed, not performed: say the deletion is awaiting their confirmation.',
    '- Use search_events or sum_spend when the answer may lie outside the recent records below.',
    '- After acting, state plainly what you did. Be concise; reply in plain text.',
    '- Keep every amount in the currency it is stored in.',
```

Leave the `CAR:` / `SERVICE HISTORY` / `REMINDERS` blocks below it untouched.

**(d)** Replace the whole `chat(...)` method with `chatTurn(...)`:

```ts
  // One model call in the domain's chat tool loop. Maps the neutral transcript onto
  // Bedrock content blocks and maps the response back. Loop policy (round count, time
  // budget) lives in the domain use-case — this method makes exactly one call.
  async chatTurn(
    transcript: ChatTurnEntry[],
    context: CarChatContext,
    attachments: ChatAttachment[],
    tools: ChatToolDefinition[],
  ): Promise<ChatTurnResult> {
    // Attach the current turn's files to the LAST user entry as vision blocks, mirroring
    // extractEventsFromDocument. Earlier turns stay plain text — their analysis already
    // lives in the assistant replies, and re-sending bytes would blow the cap.
    const lastUserIdx = transcript.reduce(
      (found, entry, i) => (entry.role === 'user' ? i : found), -1,
    );
    const messages = transcript.map((entry, i) => {
      if (entry.role === 'assistant') {
        // `raw` is this adapter's own content array from a previous round, echoed back
        // UNCHANGED — Bedrock rejects modified thinking blocks.
        return { role: 'assistant' as const, content: entry.raw as ContentBlockParam[] };
      }
      if (entry.role === 'tool_results') {
        return {
          role: 'user' as const,
          content: entry.results.map((r) => ({
            type: 'tool_result' as const,
            tool_use_id: r.id,
            content: r.content,
            is_error: r.isError,
          })),
        };
      }
      if (i === lastUserIdx && attachments.length > 0) {
        const blocks = attachments.map((a) => a.mediaType === 'application/pdf'
          ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: a.base64 } }
          : { type: 'image' as const, source: { type: 'base64' as const, media_type: a.mediaType as 'image/jpeg' | 'image/png' | 'image/webp', data: a.base64 } });
        return { role: 'user' as const, content: [...blocks, { type: 'text' as const, text: entry.content }] };
      }
      return { role: 'user' as const, content: entry.content };
    });

    let res;
    try {
      res = await this.client.messages.create({
        model: MODEL,
        // Headroom above a short answer: adaptive thinking shares this budget with the
        // reply and any tool_use blocks.
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        // 'low' keeps each round well inside the ~29s Lambda / 30s API Gateway cap; a
        // tool turn makes several of these calls back to back.
        output_config: { effort: 'low' },
        system: chatSystem(context, new Date().toISOString().slice(0, 10)),
        ...(tools.length > 0
          ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) }
          : {}),
        messages,
      });
    } catch (err) {
      const e = err as Error;
      console.error('Bedrock chat failed', e.name, e.message);
      throw new LlmUnavailableError();
    }

    const text = res.content.map((c) => ('text' in c ? c.text : '')).join('').trim();
    const toolCalls = res.content
      .filter((c): c is Extract<typeof c, { type: 'tool_use' }> => c.type === 'tool_use')
      .map((c) => ({ id: c.id, name: c.name, input: c.input }));
    return { text, toolCalls, raw: res.content };
  }
```

**(e)** Add the SDK content-block type import at the top so `raw` can be cast without `any`:

```ts
import type { ContentBlockParam } from '@anthropic-ai/bedrock-sdk/resources/messages';
```

If that subpath does not resolve, run `node -e "console.log(Object.keys(require('@anthropic-ai/bedrock-sdk')))"` and check `node_modules/@anthropic-ai/bedrock-sdk` for the correct export path, then use it. Do **not** fall back to `any`; if no exported type exists, declare a local `type ContentBlockParam = Record<string, unknown>` with a comment saying why.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @carlog/api typecheck`
Expected: FAIL only in `chat-session-routes.ts` (it still calls the removed 6-arg `chatAboutCar`/`llm.chat`). Every other file compiles. That route is Task 6.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bedrock-llm-provider.ts apps/api/src/in-memory-llm-provider.ts
git commit -m "feat(api): Bedrock chatTurn with tool support"
```

---

### Task 6: API — the tool executor

**Files:**
- Create: `apps/api/src/event-delete.ts`
- Create: `apps/api/src/chat-tool-executor.ts`
- Create: `apps/api/src/chat-tool-executor.test.ts`
- Modify: `apps/api/src/event-routes.ts:124-139`

**Interfaces:**
- Consumes: `ChatToolExecutor`, `ChatToolCall`, `ChatToolOutcome` (Task 3); `searchEvents`, `sumSpend` (Task 2); `ChatAction` (Task 1).
- Produces:
  - `deleteEventCascade(deps: { events: EventRepository; proofs: ProofRepository; storage: PhotoStorage }, ownerId: string, carId: string, eventId: string): Promise<void>` in `event-delete.ts`.
  - `type ChatToolExecutorDeps = { cars: CarRepository; events: EventRepository; reminders: ReminderRepository; car: Car; timeline: Event[]; ownerId: string; carId: string; newId: () => string }`
  - `class DomainChatToolExecutor implements ChatToolExecutor` with `constructor(deps: ChatToolExecutorDeps)`.

- [ ] **Step 1: Extract the event-delete cascade**

Create `apps/api/src/event-delete.ts`:

```ts
import type { EventRepository, ProofRepository, PhotoStorage } from '@carlog/domain';
import { proofKey } from './event-key';

export type EventDeleteDeps = {
  events: EventRepository; proofs: ProofRepository; storage: PhotoStorage;
};

// Delete an event and its proofs. Proof objects + rows go FIRST, so an interrupted delete
// never leaves proof rows under a missing event, and the whole op is safe to retry (S3
// DeleteObject is idempotent). Narrow window: if proofs.delete throws after a successful
// deleteObject, that one S3 object is orphaned; a retry of the whole delete cleans it up.
// Shared by DELETE /cars/{id}/events/{eventId} and the chat delete-confirmation route.
export async function deleteEventCascade(
  deps: EventDeleteDeps, ownerId: string, carId: string, eventId: string,
): Promise<void> {
  const proofs = await deps.proofs.listByEvent(ownerId, carId, eventId);
  for (const p of proofs) {
    await deps.storage.deleteObject(proofKey(ownerId, carId, eventId, p.id));
    await deps.proofs.delete(ownerId, carId, eventId, p.id);
  }
  await deps.events.delete(ownerId, carId, eventId);
}
```

In `apps/api/src/event-routes.ts`, replace the DELETE branch body (the block currently spanning the cascade comment through `await deps.events.delete(...)`) with:

```ts
  if (eventId && path === `${base}/${eventId}` && method === 'DELETE') {
    await requireCar(deps, ownerId, carId);
    await deleteEventCascade(deps, ownerId, carId, eventId);
    return ok(204, null);
  }
```

and add the import `import { deleteEventCascade } from './event-delete';`. The now-unused `proofKey` import stays — the proof sub-routes above still use it.

- [ ] **Step 2: Write the failing executor test**

Create `apps/api/src/chat-tool-executor.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import type { Car, Event, Reminder } from '@carlog/contracts';
import { InMemoryCarRepository } from './in-memory-car-repository';
import { InMemoryEventRepository } from './in-memory-event-repository';
import { InMemoryReminderRepository } from './in-memory-reminder-repository';
import { DomainChatToolExecutor } from './chat-tool-executor';

const OWNER = 'owner-1';
const CAR_ID = '33333333-3333-4333-8333-333333333333';

const car: Car = {
  id: CAR_ID, ownerId: OWNER, make: 'VW', model: 'Golf', year: 2018, mileage: 90000,
  fuelType: 'diesel', engineVolume: 2, nickname: 'Wolfie', vin: undefined, licensePlate: undefined,
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', shared: false,
};

let ids = 0;
const newId = () => `00000000-0000-4000-8000-${String(ids++).padStart(12, '0')}`;

describe('DomainChatToolExecutor', () => {
  let cars: InMemoryCarRepository;
  let events: InMemoryEventRepository;
  let reminders: InMemoryReminderRepository;

  const build = (timeline: Event[] = []) => new DomainChatToolExecutor({
    cars, events, reminders, car, timeline, ownerId: OWNER, carId: CAR_ID, newId,
  });

  beforeEach(async () => {
    ids = 0;
    cars = new InMemoryCarRepository();
    events = new InMemoryEventRepository();
    reminders = new InMemoryReminderRepository();
    await cars.create(car);
  });

  it('creates a reminder and reports a done action', async () => {
    const out = await build().execute({
      id: 't1', name: 'create_reminder',
      input: { title: 'Oil change', category: 'oil_change', dueMileage: 100000 },
    });
    expect(out.isError).toBe(false);
    expect(out.action?.kind).toBe('create_reminder');
    expect(out.action?.status).toBe('done');
    expect(out.action?.summary).toContain('Oil change');
    const stored = await reminders.listByCar(OWNER, CAR_ID);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.dueMileage).toBe(100000);
  });

  it('rejects an invalid reminder without writing', async () => {
    const out = await build().execute({
      id: 't1', name: 'create_reminder',
      input: { title: 'No target', category: 'other' }, // neither dueDate nor dueMileage
    });
    expect(out.isError).toBe(true);
    expect(out.content.toLowerCase()).toContain('due');
    expect(out.action).toBeUndefined();
    expect(await reminders.listByCar(OWNER, CAR_ID)).toEqual([]);
  });

  it('enforces the per-car reminder cap', async () => {
    for (let i = 0; i < 20; i += 1) {
      await build().execute({
        id: 't', name: 'create_reminder',
        input: { title: `r${i}`, category: 'other', dueMileage: 100000 + i },
      });
    }
    const out = await build().execute({
      id: 't', name: 'create_reminder',
      input: { title: 'one too many', category: 'other', dueMileage: 200000 },
    });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('20');
    expect(await reminders.listByCar(OWNER, CAR_ID)).toHaveLength(20);
  });

  it('merges only the given fields when updating a reminder', async () => {
    const created = await build().execute({
      id: 't1', name: 'create_reminder',
      input: { title: 'Oil', category: 'oil_change', dueMileage: 100000, notes: 'keep me' },
    });
    const rid = created.action!.entityId!;
    const out = await build().execute({
      id: 't2', name: 'update_reminder', input: { id: rid, dueMileage: 110000 },
    });
    expect(out.isError).toBe(false);
    const stored = await reminders.getById(OWNER, CAR_ID, rid);
    expect(stored!.dueMileage).toBe(110000);
    expect(stored!.title).toBe('Oil');        // preserved
    expect(stored!.notes).toBe('keep me');    // preserved
  });

  it('reports not-found for an unknown reminder id', async () => {
    const out = await build().execute({
      id: 't1', name: 'update_reminder',
      input: { id: '99999999-9999-4999-8999-999999999999', dueMileage: 1 },
    });
    expect(out.isError).toBe(true);
    expect(out.content.toLowerCase()).toContain('no reminder');
  });

  it('proposes a reminder delete without deleting', async () => {
    const created = await build().execute({
      id: 't1', name: 'create_reminder',
      input: { title: 'Doomed', category: 'other', dueMileage: 100000 },
    });
    const rid = created.action!.entityId!;
    const out = await build().execute({ id: 't2', name: 'delete_reminder', input: { id: rid } });
    expect(out.isError).toBe(false);
    expect(out.action?.status).toBe('pending');
    expect(out.action?.pending).toEqual({ target: 'reminder', entityId: rid });
    expect(await reminders.getById(OWNER, CAR_ID, rid)).not.toBeNull(); // still there
  });

  it('creates an event and bumps the car odometer', async () => {
    const out = await build().execute({
      id: 't1', name: 'create_event',
      input: { date: '2026-08-04', mileage: 95000, category: 'oil_change', cost: 1800, title: 'Oil' },
    });
    expect(out.isError).toBe(false);
    expect(out.action?.kind).toBe('create_event');
    expect((await events.listByCar(OWNER, CAR_ID))).toHaveLength(1);
    expect((await cars.getById(OWNER, CAR_ID))!.mileage).toBe(95000);
  });

  it('does not lower the odometer for an older event', async () => {
    await build().execute({
      id: 't1', name: 'create_event',
      input: { date: '2020-01-01', mileage: 10000, category: 'other' },
    });
    expect((await cars.getById(OWNER, CAR_ID))!.mileage).toBe(90000); // unchanged
  });

  it('proposes an event delete without deleting', async () => {
    const created = await build().execute({
      id: 't1', name: 'create_event',
      input: { date: '2026-08-04', mileage: 95000, category: 'other' },
    });
    const eid = created.action!.entityId!;
    const out = await build().execute({ id: 't2', name: 'delete_event', input: { id: eid } });
    expect(out.action?.status).toBe('pending');
    expect(out.action?.pending).toEqual({ target: 'event', entityId: eid });
    expect(await events.getById(OWNER, CAR_ID, eid)).not.toBeNull();
  });

  it('merges only the given fields when updating the car', async () => {
    const out = await build().execute({
      id: 't1', name: 'update_car', input: { mileage: 99000 },
    });
    expect(out.isError).toBe(false);
    const stored = await cars.getById(OWNER, CAR_ID);
    expect(stored!.mileage).toBe(99000);
    expect(stored!.nickname).toBe('Wolfie'); // preserved
    expect(stored!.make).toBe('VW');
  });

  it('rejects an update_car with no fields', async () => {
    const out = await build().execute({ id: 't1', name: 'update_car', input: {} });
    expect(out.isError).toBe(true);
  });

  it('answers search_events from the full timeline', async () => {
    const timeline: Event[] = [{
      id: 'old-1', carId: CAR_ID, ownerId: OWNER, date: '2015-03-01', category: 'brakes',
      mileage: 40000, cost: 900, currency: 'UAH', title: 'Rear pads', notes: undefined, works: [],
      createdAt: '2015-03-01T00:00:00.000Z', updatedAt: '2015-03-01T00:00:00.000Z',
    }];
    const out = await build(timeline).execute({
      id: 't1', name: 'search_events', input: { category: 'brakes' },
    });
    expect(out.isError).toBe(false);
    expect(out.content).toContain('2015-03-01');
    expect(out.content).toContain('Rear pads');
    expect(out.action).toBeUndefined(); // reads are not side effects
  });

  it('answers sum_spend per currency', async () => {
    const mk = (id: string, cost: number, currency: string): Event => ({
      id, carId: CAR_ID, ownerId: OWNER, date: '2020-01-01', category: 'other',
      mileage: 1, cost, currency, title: undefined, notes: undefined, works: [],
      createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    });
    const out = await build([mk('a', 100, 'UAH'), mk('b', 5, 'USD')]).execute({
      id: 't1', name: 'sum_spend', input: {},
    });
    expect(out.content).toContain('100 UAH');
    expect(out.content).toContain('5 USD');
    expect(out.action).toBeUndefined();
  });

  it('reports an unknown tool as an error rather than throwing', async () => {
    const out = await build().execute({ id: 't1', name: 'drop_database', input: {} });
    expect(out.isError).toBe(true);
    expect(out.content.toLowerCase()).toContain('unknown tool');
  });

  it('cannot reach another owner entity', async () => {
    const other = new InMemoryReminderRepository();
    const foreign: Reminder = {
      id: '44444444-4444-4444-8444-444444444444', carId: CAR_ID, ownerId: 'someone-else',
      title: 'Not yours', category: 'other', dueMileage: 1, notes: undefined,
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    };
    await other.create(foreign);
    // Our executor is scoped to OWNER, so the id resolves to nothing.
    const out = await build().execute({
      id: 't1', name: 'update_reminder', input: { id: foreign.id, dueMileage: 2 },
    });
    expect(out.isError).toBe(true);
    expect(out.content.toLowerCase()).toContain('no reminder');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @carlog/api test src/chat-tool-executor.test.ts`
Expected: FAIL — cannot resolve `./chat-tool-executor`.

- [ ] **Step 4: Write the executor**

Create `apps/api/src/chat-tool-executor.ts`:

```ts
import { ZodError } from 'zod';
import {
  CreateReminderSchema, CreateEventSchema, CreateCarSchema, MAX_REMINDERS_PER_CAR,
  type Car, type Event, type Reminder, type ChatAction, type ChatActionKind,
} from '@carlog/contracts';
import {
  createReminder, createEvent, bumpCarMileage, searchEvents, sumSpend,
  type CarRepository, type EventRepository, type ReminderRepository,
  type ChatToolExecutor, type ChatToolCall, type ChatToolOutcome,
} from '@carlog/domain';

export type ChatToolExecutorDeps = {
  cars: CarRepository;
  events: EventRepository;
  reminders: ReminderRepository;
  car: Car;            // the authorized car, already loaded by the route
  timeline: Event[];    // the FULL event list, already loaded for the chat context
  ownerId: string;
  carId: string;
  newId: () => string;
};

const ok = (content: string, action?: ChatAction): ChatToolOutcome => ({ content, isError: false, action });
const fail = (content: string): ChatToolOutcome => ({ content, isError: true });

// Zod messages are what the model reads to correct itself, so surface the path too.
const zodMessage = (err: ZodError): string =>
  err.issues.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');

// Drop keys the model omitted so a partial update merges instead of clearing fields.
const defined = (input: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));

const asRecord = (input: unknown): Record<string, unknown> =>
  (typeof input === 'object' && input !== null ? { ...(input as Record<string, unknown>) } : {});

const reminderSummary = (r: Reminder): string => {
  const due = [r.dueDate ? `by ${r.dueDate}` : null, r.dueMileage ? `at ${r.dueMileage} km` : null]
    .filter(Boolean).join(' / ');
  return `${r.title}${due ? ` — due ${due}` : ''}`;
};

const eventSummary = (e: Event): string =>
  `${e.date} · ${e.category}${e.title ? ` — ${e.title}` : ''}${e.mileage > 0 ? ` (${e.mileage} km)` : ''}`;

// Executes the chat model's tool calls against the repositories. ownerId/carId always come
// from the authorized request context — NEVER from tool input — so the model can at most
// name an entity id, and a wrong id fails the owner-scoped lookup.
export class DomainChatToolExecutor implements ChatToolExecutor {
  constructor(private readonly deps: ChatToolExecutorDeps) {}

  async execute(call: ChatToolCall): Promise<ChatToolOutcome> {
    try {
      return await this.dispatch(call);
    } catch (err) {
      if (err instanceof ZodError) return fail(`Invalid input: ${zodMessage(err)}`);
      // One failed tool must not fail the whole turn — report it so the model can adapt.
      console.error('chat tool failed', call.name, err);
      return fail('That operation failed. Tell the owner it did not go through.');
    }
  }

  private action(kind: ChatActionKind, summary: string, entityId?: string): ChatAction {
    return { id: this.deps.newId(), kind, status: 'done', summary, entityId };
  }

  private pending(kind: ChatActionKind, target: 'reminder' | 'event', entityId: string, summary: string): ChatAction {
    return { id: this.deps.newId(), kind, status: 'pending', summary, entityId, pending: { target, entityId } };
  }

  private async dispatch(call: ChatToolCall): Promise<ChatToolOutcome> {
    const { ownerId, carId } = this.deps;
    const input = asRecord(call.input);

    switch (call.name) {
      case 'create_reminder': {
        const existing = await this.deps.reminders.listByCar(ownerId, carId);
        if (existing.length >= MAX_REMINDERS_PER_CAR) {
          return fail(`This car already has the maximum of ${MAX_REMINDERS_PER_CAR} reminders.`);
        }
        const parsed = CreateReminderSchema.parse(defined(input));
        const created = await this.deps.reminders.create(
          createReminder(ownerId, carId, parsed, { newId: this.deps.newId }),
        );
        const summary = reminderSummary(created);
        return ok(`Created reminder: ${summary}. id=${created.id}`,
          this.action('create_reminder', summary, created.id));
      }

      case 'update_reminder': {
        const { id, ...rest } = input;
        if (typeof id !== 'string') return fail('An existing reminder id is required.');
        const current = await this.deps.reminders.getById(ownerId, carId, id);
        if (!current) return fail('No reminder with that id for this car.');
        // Partial merge: strip the persisted-only fields, overlay the given ones, re-parse.
        const { id: _i, carId: _c, ownerId: _o, createdAt: _cr, updatedAt: _u, ...fields } = current;
        const parsed = CreateReminderSchema.parse({ ...fields, ...defined(rest) });
        const updated = await this.deps.reminders.update(ownerId, carId, id, parsed);
        const summary = reminderSummary(updated);
        return ok(`Updated reminder: ${summary}.`, this.action('update_reminder', summary, id));
      }

      case 'delete_reminder': {
        const { id } = input;
        if (typeof id !== 'string') return fail('An existing reminder id is required.');
        const current = await this.deps.reminders.getById(ownerId, carId, id);
        if (!current) return fail('No reminder with that id for this car.');
        const summary = `Delete reminder: ${reminderSummary(current)}`;
        return ok(
          `Deletion of reminder "${current.title}" is awaiting the owner's confirmation in the chat. Do not retry.`,
          this.pending('delete_reminder', 'reminder', id, summary),
        );
      }

      case 'create_event': {
        const parsed = CreateEventSchema.parse(defined(input));
        const created = await this.deps.events.create(
          createEvent(ownerId, carId, parsed, { newId: this.deps.newId }),
        );
        const bumped = bumpCarMileage(this.deps.car, created.mileage);
        if (bumped) await this.deps.cars.update(ownerId, carId, bumped);
        const summary = eventSummary(created);
        return ok(`Logged: ${summary}. id=${created.id}`,
          this.action('create_event', summary, created.id));
      }

      case 'update_event': {
        const { id, ...rest } = input;
        if (typeof id !== 'string') return fail('An existing event id is required.');
        const current = await this.deps.events.getById(ownerId, carId, id);
        if (!current) return fail('No timeline entry with that id for this car.');
        const { id: _i, carId: _c, ownerId: _o, createdAt: _cr, updatedAt: _u, ...fields } = current;
        const parsed = CreateEventSchema.parse({ ...fields, ...defined(rest) });
        const updated = await this.deps.events.update(ownerId, carId, id, parsed);
        const bumped = bumpCarMileage(this.deps.car, updated.mileage);
        if (bumped) await this.deps.cars.update(ownerId, carId, bumped);
        const summary = eventSummary(updated);
        return ok(`Updated: ${summary}.`, this.action('update_event', summary, id));
      }

      case 'delete_event': {
        const { id } = input;
        if (typeof id !== 'string') return fail('An existing event id is required.');
        const current = await this.deps.events.getById(ownerId, carId, id);
        if (!current) return fail('No timeline entry with that id for this car.');
        const summary = `Delete entry: ${eventSummary(current)}`;
        return ok(
          'Deletion of that entry is awaiting the owner\'s confirmation in the chat. Do not retry.',
          this.pending('delete_event', 'event', id, summary),
        );
      }

      case 'update_car': {
        const fields = defined(input);
        if (Object.keys(fields).length === 0) return fail('No car fields were given to change.');
        const { id: _i, ownerId: _o, createdAt: _c, updatedAt: _u, shared: _s, ...current } = this.deps.car;
        const parsed = CreateCarSchema.parse({ ...current, ...fields });
        const updated = await this.deps.cars.update(ownerId, carId, parsed);
        const summary = `Updated ${Object.keys(fields).join(', ')} on ${updated.make} ${updated.model}`;
        return ok(`${summary}.`, this.action('update_car', summary, carId));
      }

      case 'search_events': {
        const found = searchEvents(this.deps.timeline, {
          category: input.category as Event['category'] | undefined,
          from: input.from as string | undefined,
          to: input.to as string | undefined,
          text: input.text as string | undefined,
          limit: input.limit as number | undefined,
        });
        if (found.length === 0) return ok('No matching entries in the full history.');
        const lines = found.map((e) => {
          const cost = e.cost > 0 ? ` · ${e.cost} ${e.currency}` : '';
          const works = e.works.map((w) => w.description).join(', ');
          return `- ${eventSummary(e)}${cost}${works ? ` · ${works}` : ''}`;
        });
        return ok(`${found.length} matching entries (newest first):\n${lines.join('\n')}`);
      }

      case 'sum_spend': {
        const { totals, count } = sumSpend(this.deps.timeline, {
          category: input.category as Event['category'] | undefined,
          from: input.from as string | undefined,
          to: input.to as string | undefined,
        });
        if (count === 0) return ok('No entries match, so nothing was spent on that.');
        const parts = totals.map((t) => `${t.total} ${t.currency}`).join(' + ');
        return ok(`${parts} across ${count} entr${count === 1 ? 'y' : 'ies'}.`);
      }

      default:
        return fail(`Unknown tool "${call.name}".`);
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @carlog/api test src/chat-tool-executor.test.ts`
Expected: PASS (16 cases).

If `InMemoryReminderRepository` or `InMemoryCarRepository` lack a method used above, read the file and adapt the test to the real API — do **not** change production code to fit a test.

- [ ] **Step 6: Confirm the extracted cascade still works**

Run: `pnpm --filter @carlog/api test src/router.test.ts`
Expected: PASS — the event DELETE tests exercise `deleteEventCascade` through the route.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/event-delete.ts apps/api/src/chat-tool-executor.ts apps/api/src/chat-tool-executor.test.ts apps/api/src/event-routes.ts
git commit -m "feat(api): chat tool executor over the domain use-cases"
```

---

### Task 7: API — wire the loop and add confirm/decline routes

**Files:**
- Modify: `apps/api/src/chat-session-routes.ts`
- Create: `apps/api/src/chat-session-routes.test.ts`
- Modify: `infrastructure/cdk/lib/carlog-stack.ts`

**Interfaces:**
- Consumes: `chatAboutCar` (Task 4), `DomainChatToolExecutor` (Task 6), `deleteEventCascade` (Task 6), `ChatAction` (Task 1).
- Produces: `ChatDeps` gains `proofs: ProofRepository`. Two routes:
  - `POST /cars/{carId}/chat/sessions/{sid}/actions/{aid}/confirm` → 200 `ChatSession` | 404 | 409
  - `POST /cars/{carId}/chat/sessions/{sid}/actions/{aid}/decline` → 200 `ChatSession` | 404 | 409

- [ ] **Step 1: Write the failing route test**

Create `apps/api/src/chat-session-routes.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import type { Car, ChatSession, ChatAction } from '@carlog/contracts';
import type { ChatSessionRecord, LlmProvider } from '@carlog/domain';
import { LlmUnavailableError } from './llm-errors';
import { InMemoryCarRepository } from './in-memory-car-repository';
import { InMemoryEventRepository } from './in-memory-event-repository';
import { InMemoryReminderRepository } from './in-memory-reminder-repository';
import { InMemoryChatSessionRepository } from './in-memory-chat-session-repository';
import { InMemoryProofRepository } from './in-memory-proof-repository';
import { InMemoryLlmProvider } from './in-memory-llm-provider';
import { handleChatRoute, type ChatDeps } from './chat-session-routes';
import type { ApiEvent } from './router';

const OWNER = 'owner-1';
const CAR_ID = '33333333-3333-4333-8333-333333333333';
const SID = '55555555-5555-4555-8555-555555555555';
const AID = '66666666-6666-4666-8666-666666666666';
const RID = '77777777-7777-4777-8777-777777777777';

const car: Car = {
  id: CAR_ID, ownerId: OWNER, make: 'VW', model: 'Golf', year: 2018, mileage: 90000,
  fuelType: 'diesel', engineVolume: undefined, nickname: undefined, vin: undefined,
  licensePlate: undefined, createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z', shared: false,
};

// A stub storage: chat attachments are not exercised by these tests.
const storage = {
  presignPut: async () => 'https://example.test/put',
  presignGet: async () => 'https://example.test/get',
  exists: async () => true,
  deleteObject: async () => undefined,
  copyObject: async () => undefined,
};

const pendingAction: ChatAction = {
  id: AID, kind: 'delete_reminder', status: 'pending',
  summary: 'Delete reminder: Oil change', entityId: RID,
  pending: { target: 'reminder', entityId: RID },
};

const post = (path: string): ApiEvent => ({
  method: 'POST', path, ownerId: OWNER, groups: [],
  pathParams: { id: CAR_ID, sid: SID, aid: AID }, queryParams: {}, body: null,
});

describe('chat action confirm/decline', () => {
  let deps: ChatDeps;
  let reminders: InMemoryReminderRepository;
  let sessions: InMemoryChatSessionRepository;

  const seedSession = async (action: ChatAction) => {
    const record: ChatSessionRecord = {
      id: SID, carId: CAR_ID, ownerId: OWNER, title: 'chat',
      messages: [
        { role: 'user', content: 'delete it', attachments: [], actions: [], createdAt: '2026-08-04T10:00:00.000Z' },
        { role: 'assistant', content: 'awaiting confirmation', attachments: [], actions: [action], createdAt: '2026-08-04T10:00:01.000Z' },
      ],
      createdAt: '2026-08-04T10:00:00.000Z', updatedAt: '2026-08-04T10:00:01.000Z',
    };
    await sessions.create(record);
  };

  beforeEach(async () => {
    const cars = new InMemoryCarRepository();
    await cars.create(car);
    reminders = new InMemoryReminderRepository();
    await reminders.create({
      id: RID, carId: CAR_ID, ownerId: OWNER, title: 'Oil change', category: 'oil_change',
      dueMileage: 100000, notes: undefined,
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    });
    sessions = new InMemoryChatSessionRepository();
    deps = {
      cars, events: new InMemoryEventRepository(), reminders, sessions,
      proofs: new InMemoryProofRepository(), storage, llm: new InMemoryLlmProvider(null),
      loadS3Base64: async () => null, newId: () => AID,
    };
  });

  it('confirm performs the delete and marks the action done', async () => {
    await seedSession(pendingAction);
    const res = await handleChatRoute(deps, post(`/cars/${CAR_ID}/chat/sessions/${SID}/actions/${AID}/confirm`), OWNER, CAR_ID);
    expect(res?.statusCode).toBe(200);
    const session = JSON.parse(res!.body) as ChatSession;
    expect(session.messages[1]!.actions[0]!.status).toBe('done');
    expect(await reminders.getById(OWNER, CAR_ID, RID)).toBeNull();
  });

  it('decline leaves the entity alone and marks the action declined', async () => {
    await seedSession(pendingAction);
    const res = await handleChatRoute(deps, post(`/cars/${CAR_ID}/chat/sessions/${SID}/actions/${AID}/decline`), OWNER, CAR_ID);
    expect(res?.statusCode).toBe(200);
    const session = JSON.parse(res!.body) as ChatSession;
    expect(session.messages[1]!.actions[0]!.status).toBe('declined');
    expect(await reminders.getById(OWNER, CAR_ID, RID)).not.toBeNull();
  });

  it('a second confirm is a 409, not a second delete', async () => {
    await seedSession(pendingAction);
    const path = `/cars/${CAR_ID}/chat/sessions/${SID}/actions/${AID}/confirm`;
    expect((await handleChatRoute(deps, post(path), OWNER, CAR_ID))?.statusCode).toBe(200);
    const again = await handleChatRoute(deps, post(path), OWNER, CAR_ID);
    expect(again?.statusCode).toBe(409);
  });

  it('an unknown action id is a 404', async () => {
    await seedSession({ ...pendingAction, id: '88888888-8888-4888-8888-888888888888' });
    const res = await handleChatRoute(deps, post(`/cars/${CAR_ID}/chat/sessions/${SID}/actions/${AID}/confirm`), OWNER, CAR_ID);
    expect(res?.statusCode).toBe(404);
  });

  it('confirming an already-declined action is a 409', async () => {
    await seedSession({ ...pendingAction, status: 'declined' });
    const res = await handleChatRoute(deps, post(`/cars/${CAR_ID}/chat/sessions/${SID}/actions/${AID}/confirm`), OWNER, CAR_ID);
    expect(res?.statusCode).toBe(409);
  });

  it('persists committed actions when the provider dies mid-turn', async () => {
    // Round 1 creates a reminder; round 2 throws. The turn must still be recorded.
    const boom = new LlmUnavailableError();
    let round = 0;
    const flaky: LlmProvider = {
      extractEvents: async () => null,
      extractEventsFromDocument: async () => null,
      chatTurn: async () => {
        round += 1;
        if (round === 1) {
          return {
            text: '', raw: { r: 1 },
            toolCalls: [{
              id: 'tu1', name: 'create_reminder',
              input: { title: 'From chat', category: 'other', dueMileage: 150000 },
            }],
          };
        }
        throw boom;
      },
    };
    const empty: ChatSessionRecord = {
      id: SID, carId: CAR_ID, ownerId: OWNER, title: '', messages: [],
      createdAt: '2026-08-04T10:00:00.000Z', updatedAt: '2026-08-04T10:00:00.000Z',
    };
    await sessions.create(empty);
    const res = await handleChatRoute(
      { ...deps, llm: flaky },
      { ...post(`/cars/${CAR_ID}/chat/sessions/${SID}/messages`), body: { content: 'add a reminder' } },
      OWNER, CAR_ID,
    );
    expect(res?.statusCode).toBe(200);
    const { session } = JSON.parse(res!.body) as { session: ChatSession };
    const assistant = session.messages.at(-1)!;
    expect(assistant.role).toBe('assistant');
    expect(assistant.actions[0]!.kind).toBe('create_reminder');
    expect(assistant.actions[0]!.status).toBe('done');
    // The write really happened — it must not be silently lost behind a 503.
    expect(await reminders.listByCar(OWNER, CAR_ID)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/api test src/chat-session-routes.test.ts`
Expected: FAIL — routes not matched (`handleChatRoute` returns `null`, so `res?.statusCode` is `undefined`).

- [ ] **Step 3: Wire the loop into the messages route**

In `apps/api/src/chat-session-routes.ts`:

**(a)** Update the imports:

```ts
import {
  PostMessageRequestSchema, RenameSessionRequestSchema, ChatAttachmentPresignRequestSchema,
  maxScanSize, type ChatSession, type ChatMessageView, type StoredChatMessage, type ChatAction,
} from '@carlog/contracts';
import {
  CarNotFoundError, chatAboutCar, ChatTurnInterruptedError, buildCarChatContext,
  newChatSession, appendMessage, nowIso,
  type CarRepository, type EventRepository, type ReminderRepository, type LlmProvider,
  type ChatSessionRepository, type ChatSessionRecord, type ChatAttachment, type PhotoStorage,
  type ProofRepository,
} from '@carlog/domain';
import { DomainChatToolExecutor } from './chat-tool-executor';
import { deleteEventCascade } from './event-delete';
```

**(b)** Add `proofs` to `ChatDeps`:

```ts
export type ChatDeps = {
  cars: CarRepository;
  events: EventRepository;
  reminders: ReminderRepository;
  proofs: ProofRepository;   // needed to cascade a confirmed event delete
  sessions: ChatSessionRepository;
  storage: PhotoStorage;
  llm: LlmProvider;
  loadS3Base64: (key: string) => Promise<string | null>;
  newId: () => string;
};
```

**(c)** In `toSessionView`, carry `actions` through to the view:

```ts
  const messages: ChatMessageView[] = await Promise.all(session.messages.map(async (m) => ({
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
    actions: m.actions,
    attachments: await Promise.all(m.attachments.map(async (a) => ({ ...a, url: await storage.presignGet(a.key) }))),
  })));
```

**(d)** In the messages branch, replace the `const reply = await chatAboutCar(...)` line and the assistant-message construction with:

```ts
    const executor = new DomainChatToolExecutor({
      cars: deps.cars, events: deps.events, reminders: deps.reminders,
      car, timeline: events, ownerId, carId, newId: deps.newId,
    });
    // A provider failure AFTER a write already committed must not 503 away the record of
    // it — persist what happened so the user (and the next turn) can see it.
    let reply: string;
    let actions: ChatAction[];
    try {
      ({ reply, actions } = await chatAboutCar(llmMessages, deps.llm, context, executor, attachments));
    } catch (err) {
      if (!(err instanceof ChatTurnInterruptedError)) throw err;
      actions = err.actions;
      reply = err.actions.map((a) => a.summary).join('\n');
      console.error('chat turn interrupted after committing changes', err.cause);
    }
    const assistantMsg: StoredChatMessage = {
      role: 'assistant', content: reply, attachments: [], actions, createdAt: nowIso(),
    };
```

Add `ChatTurnInterruptedError` to the `@carlog/domain` import (it is a value, not a type, so
it goes in the non-`type` position of that import statement).

Also add `actions: []` to the `userMsg` construction (the schema defaults it, but constructing it explicitly keeps the type literal complete).

**(e)** Add the action routes. Insert **before** the final `return null;`:

```ts
  // POST /chat/sessions/{sid}/actions/{aid}/confirm | /decline
  const aid = pathParams.aid;
  if (aid && method === 'POST'
      && (path === `${sessionPath}/actions/${aid}/confirm` || path === `${sessionPath}/actions/${aid}/decline`)) {
    const confirm = path.endsWith('/confirm');
    const session = await loadSession();
    if (!session) return ok(404, { error: 'NotFound', message: 'session not found' });

    const msgIdx = session.messages.findIndex((m) => m.actions.some((a) => a.id === aid));
    const action = msgIdx >= 0 ? session.messages[msgIdx]!.actions.find((a) => a.id === aid) : undefined;
    if (!action) return ok(404, { error: 'NotFound', message: 'action not found' });
    // Only a pending action can be resolved — this makes confirm idempotent-safe rather
    // than deleting twice on a double tap.
    if (action.status !== 'pending' || !action.pending) {
      return ok(409, { error: 'Conflict', message: 'action is already resolved' });
    }

    let next: ChatAction;
    if (!confirm) {
      next = { ...action, status: 'declined' };
    } else {
      const { target, entityId } = action.pending;
      if (target === 'reminder') {
        const existing = await deps.reminders.getById(ownerId, carId, entityId);
        if (!existing) return ok(404, { error: 'NotFound', message: 'reminder not found' });
        await deps.reminders.delete(ownerId, carId, entityId);
      } else {
        const existing = await deps.events.getById(ownerId, carId, entityId);
        if (!existing) return ok(404, { error: 'NotFound', message: 'event not found' });
        await deleteEventCascade(
          { events: deps.events, proofs: deps.proofs, storage: deps.storage },
          ownerId, carId, entityId,
        );
      }
      next = { ...action, status: 'done' };
    }

    const messages = session.messages.map((m, i) => (i === msgIdx
      ? { ...m, actions: m.actions.map((a) => (a.id === aid ? next : a)) }
      : m));
    const saved = await deps.sessions.save({ ...session, messages, updatedAt: nowIso() });
    return ok(200, await toSessionView(saved, deps.storage));
  }
```

**(f)** `renderForModel` is unchanged.

- [ ] **Step 4: Pass `proofs` from the router**

In `apps/api/src/router.ts`, the chat branch's deps object gains `proofs: deps.proofs`:

```ts
      const result = await handleChatRoute(
        {
          cars: deps.cars, events: deps.events, reminders: deps.reminders, sessions: deps.sessions,
          proofs: deps.proofs,
          storage: deps.storage, llm: deps.llm, loadS3Base64: deps.loadScanBase64, newId: deps.newId,
        },
        event, ownerId, id,
      );
```

- [ ] **Step 5: Register the `aid` path parameter in CDK**

In `infrastructure/cdk/lib/carlog-stack.ts`, after the existing `chat/sessions/{sid}` route, add:

```ts
    httpApi.addRoutes({ path: '/cars/{id}/chat/sessions/{sid}/actions/{aid}/confirm', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/chat/sessions/{sid}/actions/{aid}/decline', methods: [HttpMethod.POST], integration, authorizer });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @carlog/api test src/chat-session-routes.test.ts`
Expected: PASS (6 cases).

If `InMemoryProofRepository` or `InMemoryChatSessionRepository` differ from the test's assumptions, read those files and adapt the test.

- [ ] **Step 7: Run all gates**

Run: `pnpm turbo run build lint typecheck test`
Expected: PASS across every package. The backend half of the feature is now complete.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/chat-session-routes.ts apps/api/src/chat-session-routes.test.ts apps/api/src/router.ts infrastructure/cdk/lib/carlog-stack.ts
git commit -m "feat(api): agentic chat turn plus delete confirm/decline routes"
```

---

### Task 8: Web — action UI and confirm/decline

**Files:**
- Create: `apps/web/src/components/chat/ChatActions.tsx`
- Modify: `apps/web/src/components/chat/ChatBubble.tsx`
- Modify: `apps/web/src/api-client.ts`
- Modify: `apps/web/src/queries.ts`
- Modify: `apps/web/src/i18n/locales/en/chat.json`, `apps/web/src/i18n/locales/uk/chat.json`

**Interfaces:**
- Consumes: `ChatAction` (Task 1); the two routes (Task 7).
- Produces:
  - `confirmChatAction(token, carId, sid, aid): Promise<ChatSession>` and `declineChatAction(...)` in `api-client.ts`.
  - `useResolveChatAction(carId: string)` in `queries.ts` — `mutateAsync({ sid, aid, confirm })`.
  - `<ChatActions actions={ChatAction[]} onResolve={(aid, confirm) => void} busy={boolean} />`.

- [ ] **Step 1: Add the i18n keys**

In `apps/web/src/i18n/locales/en/chat.json` add:

```json
  "actionDone": "Applied",
  "actionPending": "Needs your confirmation",
  "actionDeclined": "Dismissed",
  "actionFailed": "Didn't go through",
  "actionConfirm": "Confirm",
  "actionDismiss": "Dismiss",
  "actionError": "Couldn't apply that. Please try again.",
  "voiceStart": "Dictate a message",
  "voiceStop": "Stop dictation",
  "voiceListening": "Listening…",
  "voiceDenied": "Microphone access was denied. Allow it in your browser settings to dictate.",
  "suggestionRemind": "Remind me to change the oil in 10 000 km"
```

In `apps/web/src/i18n/locales/uk/chat.json` add:

```json
  "actionDone": "Застосовано",
  "actionPending": "Потрібне ваше підтвердження",
  "actionDeclined": "Скасовано",
  "actionFailed": "Не вдалося виконати",
  "actionConfirm": "Підтвердити",
  "actionDismiss": "Скасувати",
  "actionError": "Не вдалося застосувати. Спробуйте ще раз.",
  "voiceStart": "Надиктувати повідомлення",
  "voiceStop": "Зупинити диктування",
  "voiceListening": "Слухаю…",
  "voiceDenied": "Доступ до мікрофона заборонено. Дозвольте його в налаштуваннях браузера.",
  "suggestionRemind": "Нагадай замінити оливу через 10 000 км"
```

- [ ] **Step 2: Add the client calls**

In `apps/web/src/api-client.ts`, after `postChatMessage`:

```ts
// Resolve a pending action (a proposed delete) the assistant attached to a message.
// The server performs the delete and flips the action status, returning the new session.
export const resolveChatAction = (
  token: string, carId: string, sid: string, aid: string, confirm: boolean,
): Promise<ChatSession> =>
  request(
    token,
    `${chatBase(carId)}/sessions/${sid}/actions/${aid}/${confirm ? 'confirm' : 'decline'}`,
    ChatSessionSchema,
    { method: 'POST' },
  );
```

- [ ] **Step 3: Add the mutation**

In `apps/web/src/queries.ts`, after `usePostChatMessage`, add (and add `resolveChatAction` to the `api-client` import list):

```ts
// Confirming a delete changes events/reminders server-side, so refresh those views too.
export function useResolveChatAction(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sid, aid, confirm }: { sid: string; aid: string; confirm: boolean }) =>
      resolveChatAction(token, carId, sid, aid, confirm),
    onSuccess: (session, { sid }) => {
      qc.setQueryData(chatSessionKey(carId, sid), session);
      invalidateEventsAndCar(qc, carId);
      void qc.invalidateQueries({ queryKey: ['cars', carId, 'reminders'] });
    },
  });
}
```

Also extend `usePostChatMessage`'s `onSuccess` so a turn that changed data refreshes the other tabs:

```ts
    onSuccess: (res, { sid }) => {
      qc.setQueryData(chatSessionKey(carId, sid), res.session);
      void qc.invalidateQueries({ queryKey: chatSessionsKey(carId) });
      // A turn may have created/updated events, reminders, or the car's odometer.
      const changed = res.session.messages.at(-1)?.actions.some((a) => a.status === 'done') ?? false;
      if (changed) {
        invalidateEventsAndCar(qc, carId);
        void qc.invalidateQueries({ queryKey: ['cars', carId, 'reminders'] });
      }
    },
```

- [ ] **Step 4: Build the action list component**

Create `apps/web/src/components/chat/ChatActions.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Box, Button, Stack, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import type { ChatAction } from '@carlog/contracts';

type Props = {
  actions: ChatAction[];
  onResolve: (actionId: string, confirm: boolean) => void;
  busy: boolean;
};

// The side effects an assistant turn produced. `pending` entries are proposed deletes and
// render as a card with Confirm/Dismiss — nothing was deleted until the owner taps.
export function ChatActions({ actions, onResolve, busy }: Props) {
  const { t } = useTranslation(['chat']);
  if (actions.length === 0) return null;

  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      {actions.map((a) => {
        if (a.status === 'pending') {
          return (
            <Box key={a.id} sx={{
              p: 1.25, borderRadius: 2, border: 1, borderColor: 'warning.main',
              bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255,167,38,0.10)' : 'rgba(255,167,38,0.08)'),
            }}>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: 'warning.main', mb: 0.5 }}>
                <HelpOutlineIcon sx={{ fontSize: 16 }} />
                <Typography variant="caption" sx={{ fontWeight: 600 }}>{t('chat:actionPending')}</Typography>
              </Stack>
              <Typography variant="body2" sx={{ mb: 1 }}>{a.summary}</Typography>
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="contained" color="error" disabled={busy}
                  onClick={() => onResolve(a.id, true)}>{t('chat:actionConfirm')}</Button>
                <Button size="small" variant="text" disabled={busy}
                  onClick={() => onResolve(a.id, false)}>{t('chat:actionDismiss')}</Button>
              </Stack>
            </Box>
          );
        }

        const { icon, color, label, strike } = a.status === 'done'
          ? { icon: <CheckCircleOutlineIcon sx={{ fontSize: 16 }} />, color: 'success.main', label: t('chat:actionDone'), strike: false }
          : a.status === 'declined'
            ? { icon: <RemoveCircleOutlineIcon sx={{ fontSize: 16 }} />, color: 'text.disabled', label: t('chat:actionDeclined'), strike: true }
            : { icon: <ErrorOutlineIcon sx={{ fontSize: 16 }} />, color: 'error.main', label: t('chat:actionFailed'), strike: false };

        return (
          <Stack key={a.id} direction="row" spacing={0.75} alignItems="flex-start" sx={{ color }}>
            <Box sx={{ mt: 0.25 }}>{icon}</Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>{label}</Typography>
              <Typography variant="body2" sx={{
                color: 'text.primary',
                textDecoration: strike ? 'line-through' : 'none',
              }}>{a.summary}</Typography>
            </Box>
          </Stack>
        );
      })}
    </Stack>
  );
}
```

- [ ] **Step 5: Render actions in the bubble**

In `apps/web/src/components/chat/ChatBubble.tsx`:

- Change the signature to accept the callbacks:

```tsx
type ChatBubbleProps = ChatMessageView & {
  onResolveAction?: (actionId: string, confirm: boolean) => void;
  resolving?: boolean;
};

export function ChatBubble({ role, content, attachments, actions, onResolveAction, resolving }: ChatBubbleProps) {
```

- Add the import `import { ChatActions } from './ChatActions';`
- In the **assistant** branch, after the `<Markdown …>` line and still inside the inner `<Box>`:

```tsx
          {actions.length > 0 && onResolveAction ? (
            <ChatActions actions={actions} onResolve={onResolveAction} busy={resolving ?? false} />
          ) : null}
```

- [ ] **Step 6: Hook it up in the conversation route**

In `apps/web/src/routes/ChatConversation.tsx`:

- Add `useResolveChatAction` to the `../queries` import; add `const resolve = useResolveChatAction(id);`
- Replace the message map with:

```tsx
              {messages.map((m, i) => (
                <ChatBubble key={i} {...m}
                  resolving={resolve.isPending}
                  onResolveAction={(aid, confirm) => { void resolve.mutateAsync({ sid, aid, confirm }); }} />
              ))}
```

- The optimistic `pending` bubble passes `actions={[]}`:

```tsx
                <ChatBubble role="user" content={pending.content} createdAt="" actions={[]}
                  attachments={pending.names.map((n, i) => ({ key: `p${i}`, contentType: 'application/pdf' as const, filename: n, size: 0, url: '#' }))} />
```

- Show a resolve failure next to the existing errors:

```tsx
        {resolve.isError ? <Alert severity="error" sx={{ mb: 1 }}>{t('chat:actionError')}</Alert> : null}
```

- Add the write-flavoured suggestion chip so the capability is discoverable:

```tsx
  const suggestions = [t('chat:suggestionRemind'), t('chat:suggestionSpend'), t('chat:suggestionDue'), t('chat:suggestionSummary')];
```

- [ ] **Step 7: Verify build and lint**

Run: `pnpm turbo run lint typecheck build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/chat/ChatActions.tsx apps/web/src/components/chat/ChatBubble.tsx apps/web/src/routes/ChatConversation.tsx apps/web/src/api-client.ts apps/web/src/queries.ts apps/web/src/i18n/locales/en/chat.json apps/web/src/i18n/locales/uk/chat.json
git commit -m "feat(web): render chat actions and confirm proposed deletes"
```

---

### Task 9: Web — voice input

**Files:**
- Create: `apps/web/src/lib/useSpeechRecognition.ts`
- Create: `apps/web/src/components/chat/VoiceComposerButton.tsx`
- Modify: `apps/web/src/routes/ChatConversation.tsx`

**Interfaces:**
- Consumes: the i18n keys from Task 8 (`voiceStart`, `voiceStop`, `voiceListening`, `voiceDenied`).
- Produces:
  - `useSpeechRecognition(): { supported: boolean; listening: boolean; transcript: string; error: 'denied' | 'failed' | null; start(lang: string): void; stop(): void; reset(): void }`
  - `<VoiceComposerButton canSend listening seconds onStart onStop supported />`

- [ ] **Step 1: Write the hook**

Create `apps/web/src/lib/useSpeechRecognition.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

// The Web Speech API is absent from TypeScript's DOM lib, so declare the slice we use.
// Hand-rolled rather than pulling @types/dom-speech-recognition for two interfaces —
// and no `any`, per the project's strict-TS rule.
type SpeechAlternative = { readonly transcript: string };
type SpeechResult = { readonly isFinal: boolean; readonly length: number; readonly 0: SpeechAlternative };
type SpeechResultList = { readonly length: number; readonly [index: number]: SpeechResult };
type SpeechResultEvent = { readonly resultIndex: number; readonly results: SpeechResultList };
type SpeechErrorEvent = { readonly error: string };

type SpeechRecognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognizerCtor = new () => SpeechRecognizer;

// Chrome/Edge expose the prefixed name; Safari 14.5+ exposes both.
const recognizerCtor = (): SpeechRecognizerCtor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognizerCtor;
    webkitSpeechRecognition?: SpeechRecognizerCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export type SpeechError = 'denied' | 'failed';

// Browser-native dictation. Nothing is uploaded — no backend, no cost, no audio storage.
// `transcript` accumulates final results and appends the live interim tail, so the caller
// can stream it into an editable field.
export function useSpeechRecognition() {
  const [supported] = useState(() => recognizerCtor() !== null);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<SpeechError | null>(null);

  const recognizer = useRef<SpeechRecognizer | null>(null);
  const finalText = useRef('');
  // iOS Safari ends recognition after a short silence. While the user has not tapped
  // stop, restart so dictation doesn't die mid-sentence.
  const wantListening = useRef(false);
  const lang = useRef('en-US');

  const stop = useCallback(() => {
    wantListening.current = false;
    setListening(false);
    recognizer.current?.stop();
  }, []);

  const reset = useCallback(() => {
    finalText.current = '';
    setTranscript('');
    setError(null);
  }, []);

  const start = useCallback((language: string) => {
    const Ctor = recognizerCtor();
    if (!Ctor) return;
    lang.current = language;
    setError(null);
    finalText.current = '';
    setTranscript('');
    wantListening.current = true;

    const rec = new Ctor();
    rec.lang = language;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const result = e.results[i]!;
        const text = result[0].transcript;
        if (result.isFinal) finalText.current = `${finalText.current}${text} `;
        else interim += text;
      }
      setTranscript(`${finalText.current}${interim}`.trimStart());
    };

    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return; // the restart covers these
      const denied = e.error === 'not-allowed' || e.error === 'service-not-allowed';
      setError(denied ? 'denied' : 'failed');
      wantListening.current = false;
      setListening(false);
    };

    rec.onend = () => {
      if (!wantListening.current) { setListening(false); return; }
      try {
        rec.start(); // silence-triggered end: keep going
      } catch {
        wantListening.current = false;
        setListening(false);
      }
    };

    recognizer.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setError('failed');
      wantListening.current = false;
      setListening(false);
    }
  }, []);

  // Never leave the mic hot across a navigation.
  useEffect(() => () => {
    wantListening.current = false;
    const rec = recognizer.current;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.abort();
    }
  }, []);

  return { supported, listening, transcript, error, start, stop, reset };
}
```

- [ ] **Step 2: Build the composer button**

Create `apps/web/src/components/chat/VoiceComposerButton.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { IconButton, Stack, Typography } from '@mui/material';
import MicNoneIcon from '@mui/icons-material/MicNone';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import SendIcon from '@mui/icons-material/Send';

type Props = {
  supported: boolean;
  listening: boolean;
  seconds: number;
  canSend: boolean;   // there is text or a file to send
  sending: boolean;
  onStart: () => void;
  onStop: () => void;
};

const mmss = (total: number): string =>
  `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

// The right-hand composer slot, Telegram-style: one button that swaps between mic and
// send rather than showing both. While dictating it becomes a red stop button + timer.
export function VoiceComposerButton({ supported, listening, seconds, canSend, sending, onStart, onStop }: Props) {
  const { t } = useTranslation(['chat']);

  if (listening) {
    return (
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Typography variant="caption" color="error" aria-live="polite" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {mmss(seconds)}
        </Typography>
        <IconButton color="error" onClick={onStop} aria-label={t('chat:voiceStop')} aria-pressed
          sx={{ animation: 'carlogPulse 1.4s ease-in-out infinite',
            '@keyframes carlogPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.45 } } }}>
          <StopCircleIcon />
        </IconButton>
      </Stack>
    );
  }

  // Mic replaces send only while there is nothing to send.
  if (supported && !canSend) {
    return (
      <IconButton onClick={onStart} aria-label={t('chat:voiceStart')} aria-pressed={false}>
        <MicNoneIcon />
      </IconButton>
    );
  }

  return (
    <IconButton type="submit" color="primary" aria-label={t('chat:send')} disabled={!canSend || sending}>
      <SendIcon />
    </IconButton>
  );
}
```

- [ ] **Step 3: Wire it into the composer**

In `apps/web/src/routes/ChatConversation.tsx`:

- Remove the `SendIcon` import (the button owns it now) and add:

```tsx
import { VoiceComposerButton } from '../components/chat/VoiceComposerButton';
import { useSpeechRecognition } from '../lib/useSpeechRecognition';
```

- Add state and effects next to the other hooks:

```tsx
  const speech = useSpeechRecognition();
  const [seconds, setSeconds] = useState(0);

  // Stream the live transcript into the editable field, so it can be corrected before sending.
  useEffect(() => {
    if (speech.listening && speech.transcript) setInput(speech.transcript);
  }, [speech.listening, speech.transcript]);

  useEffect(() => {
    if (!speech.listening) { setSeconds(0); return; }
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [speech.listening]);
```

- Replace the send `<IconButton …>` at the end of the form with:

```tsx
          <VoiceComposerButton
            supported={speech.supported}
            listening={speech.listening}
            seconds={seconds}
            canSend={Boolean(input.trim()) || files.length > 0}
            sending={post.isPending}
            onStart={() => { speech.reset(); speech.start(i18n.language.startsWith('uk') ? 'uk-UA' : 'en-US'); }}
            onStop={() => speech.stop()}
          />
```

- Add `i18n` to the translation hook: `const { t, i18n } = useTranslation(['chat', 'common']);`
- Stop dictation when a message is sent — at the top of `send()`, after the guard:

```tsx
    if (speech.listening) speech.stop();
```

- Surface a mic permission error next to the other alerts:

```tsx
        {speech.error ? (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {speech.error === 'denied' ? t('chat:voiceDenied') : t('chat:error')}
          </Alert>
        ) : null}
```

- [ ] **Step 4: Verify gates**

Run: `pnpm turbo run lint typecheck build`
Expected: PASS.

- [ ] **Step 5: Manual verification**

Run: `pnpm --filter @carlog/web dev`

Check in desktop Chrome:
1. Composer shows a mic when the field is empty; typing swaps it to send.
2. Tapping the mic prompts for permission, then shows a red stop button with a running timer; speech fills the field live.
3. Stopping keeps the text editable and does **not** auto-send.
4. Denying permission shows the `voiceDenied` warning and restores the mic.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/useSpeechRecognition.ts apps/web/src/components/chat/VoiceComposerButton.tsx apps/web/src/routes/ChatConversation.tsx
git commit -m "feat(web): voice dictation in the chat composer"
```

---

### Task 10: Deploy and verify live

**Files:** none (deployment + docs).
- Modify: `CLAUDE.md` (chat surface description), `carlog-docs/API.md` (the two new routes).

**Interfaces:** none.

- [ ] **Step 1: Run every gate**

Run: `pnpm turbo run build lint typecheck test`
Expected: PASS across all packages. Do not deploy on a red gate.

- [ ] **Step 2: Synth the stack**

Run: `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk synth`
Expected: succeeds; the diff includes the two `actions/{aid}` routes.

- [ ] **Step 3: Deploy the backend**

Run: `AWS_PROFILE=yevhenii CDK_DEFAULT_REGION=us-east-1 pnpm --filter @carlog/cdk exec cdk deploy --require-approval never`
Expected: `CarLogStack` updates; `ApiUrl` / `WebUrl` outputs unchanged.

- [ ] **Step 4: Deploy the web app**

Run: `./scripts/deploy-web.sh`
Expected: build + S3 sync + CloudFront invalidation complete.

- [ ] **Step 5: Verify live**

In the deployed app, on a car with history:
1. Ask (in Ukrainian) to create a reminder → it appears as an **Applied** action, and the Reminders tab shows it.
2. Ask to delete that reminder → a **Needs your confirmation** card appears and the reminder still exists.
3. Tap Confirm → the card flips to Applied and the reminder is gone from the Reminders tab.
4. Reload mid-pending → the confirmation card survives the reload.
5. Ask "скільки я витратив на гальма?" → answered via `sum_spend`.
6. Dictate a message on a phone (iOS Safari or Android Chrome) and send it.

- [ ] **Step 6: Update the docs**

In `CLAUDE.md`, in the live-deployment paragraph, note that the chat is agentic: it can create/update reminders, events, and car details via tools, with deletes confirmed in-chat, and that the composer supports browser-native dictation.

In `carlog-docs/API.md`, add under the chat routes:

```
POST /cars/{id}/chat/sessions/{sid}/actions/{aid}/confirm   # perform a proposed delete
POST /cars/{id}/chat/sessions/{sid}/actions/{aid}/decline    # dismiss a proposed delete
```

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md carlog-docs/API.md
git commit -m "docs: agentic chat tools and voice input"
```

---

## Notes for the implementer

- **Tasks 3–7 are a chain.** Task 3 replaces `LlmProvider.chat` with `chatTurn`, which knowingly breaks `apps/api` until Task 5 and `chat-session-routes.ts` until Task 7. Each task's steps say which failures are expected; do not "fix" a downstream file early — it produces duplicated, then-conflicting edits.
- **`raw` is never inspected in the domain.** If you find yourself reaching into it outside `bedrock-llm-provider.ts`, the abstraction has leaked.
- **Follow the extension convention.** Existing relative imports in this repo are extensionless — match that.
- **Prompt caching is deliberately out of scope** (see the spec). Do not add `cache_control` in this plan.