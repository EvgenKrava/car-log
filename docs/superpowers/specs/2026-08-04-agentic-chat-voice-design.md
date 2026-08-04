# Agentic AI Chat (Tools) + Voice Input

**Date:** 2026-08-04
**Status:** Approved

## Goal

Two changes to the per-car AI chat:

1. **Make it agentic.** Today the chat is read-only RAG: the car + its events + reminders go
   into the system prompt and Claude answers in one Bedrock call. Asked "створи нагадування",
   it can only draft text and tell the user to enter it by hand. Give it **tools** so it can
   create/update reminders, events, and car details, and query the timeline past the
   60-event context cap. Creates and updates execute immediately; **deletes require the
   user to confirm** in the chat.
2. **Voice input.** Add dictation to the chat composer, modelled on the Telegram mobile
   composer: attach on the left, and a right-hand slot that swaps between mic and send.

## Non-negotiable context (from the existing codebase)

- `CHAT_TOOLS` in `apps/api/src/bedrock-llm-provider.ts:123` is an intentionally-empty
  registry, and `chat()` throws if it is non-empty without a tool loop. That guard is
  removed as part of this work; the registry concept moves to the domain.
- **API Gateway hard-caps the HTTP integration at 30s** regardless of the Lambda's 300s
  timeout (`carlog-stack.ts:148`). Chat already runs at `effort: 'low'` for this reason
  (`bedrock-llm-provider.ts:268`). A tool loop is 2–4 sequential model calls inside that
  same 30s, so the loop must be **bounded by wall-clock, not just by round count**.
- Domain (`packages/domain`) is framework-independent and must not import the AWS SDK.
  Handlers stay thin. Zod contracts in `packages/contracts` are the source of truth;
  never hand-write a type that duplicates a schema. Strict TS, never `any`.
- Reminder writes already have a cap helper: `assertReminderUnderCap`
  (`MAX_REMINDERS_PER_CAR = 20`).
- Event and reminder writes already keep the car's odometer current via `bumpCarMileage`.
- Event delete already cascades to proof S3 objects + rows (`event-routes.ts:124+`).
- `StoredChatMessage` is persisted inside the session's single DynamoDB item, which is
  capped at 100 messages and carries a 7-day `ttl`.
- Web is Material UI only, mobile-first, with an existing `chat` i18n namespace (en + uk).

## Part 1 — Agentic chat

### Where the loop lives

The tool loop goes in **`packages/domain`**, not in the Bedrock adapter. The loop's policy
(how many rounds, what the time budget is, when to stop calling tools) is application
logic and belongs where it can be unit-tested against the existing
`in-memory-llm-provider`. The provider drops to a single-call adapter.

```
POST /chat/sessions/{sid}/messages
  └─ chat-session-routes.ts        builds context + a ChatToolExecutor over the repos
       └─ chatAboutCar()           domain: the bounded tool loop
            ├─ llm.chatTurn(...)   provider: ONE Bedrock call → { text, toolCalls, raw }
            ├─ executor.execute()  api: Zod-parse → domain use-case → Dynamo
            └─ repeat ≤3 model calls / until budget low → final call with tools: []
  ← 200 { reply, session }         assistant message now carries actions[]
```

### Provider port

`LlmProvider.chat` is **replaced** by `chatTurn` (no other caller exists):

```ts
// packages/domain/src/llm-provider.ts
export type ChatToolCall = { id: string; name: string; input: unknown };

export type ChatTurnResult = {
  text: string;                 // assistant text produced this round ('' if tool-only)
  toolCalls: ChatToolCall[];    // empty ⇒ the turn is done
  raw: unknown;                 // provider-opaque assistant content, echoed back verbatim
};

export type ChatToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema; steers the model only
};

// One entry per model round. `raw` carries the provider's own assistant content.
export type ChatTurnEntry =
  | { role: 'user'; content: string }
  | { role: 'assistant'; raw: unknown }
  | { role: 'tool_results'; results: { id: string; content: string; isError: boolean }[] };

export interface LlmProvider {
  extractEvents(text: string, ctx: ExtractionContext): Promise<unknown>;
  extractEventsFromDocument(base64: string, mediaType: string, ctx: ExtractionContext): Promise<unknown>;
  chatTurn(
    transcript: ChatTurnEntry[],
    context: CarChatContext,
    attachments: ChatAttachment[],
    tools: ChatToolDefinition[],   // [] on the final, forced-text round
  ): Promise<ChatTurnResult>;
}
```

`raw: unknown` is required, not laziness: Bedrock thinking blocks **must be echoed back
unchanged** on the next round of a tool loop. The domain forwards `raw` and never inspects
it; only the adapter knows its shape. `inputSchema` is a neutral JSON-Schema record that
the adapter maps to Anthropic's `input_schema`.

### The loop

```ts
export const MAX_MODEL_CALLS = 3;
export const MIN_ROUND_BUDGET_MS = 8_000;   // headroom for one more model call
export const TURN_BUDGET_MS = 26_000;       // inside the 30s API Gateway cap
```

`chatAboutCar(messages, llm, context, attachments, executor, deps)` where
`deps = { now?: () => number }` (injected clock, mirroring `createReminder`'s `now`):

1. Build the transcript from the stored messages (same `renderForModel` treatment as today).
2. Loop, at most `MAX_MODEL_CALLS` times:
   a. `remaining = TURN_BUDGET_MS - elapsed`. If `remaining < MIN_ROUND_BUDGET_MS` **or**
      this is the last permitted call, pass `tools: []` — the model must answer in text.
   b. `chatTurn(...)`. Collect `text`. Append `{ role: 'assistant', raw }`.
   c. No `toolCalls` → done.
   d. Execute **all** calls of this round (`Promise.all`), append **one**
      `{ role: 'tool_results', results }` entry.
3. Return `{ reply, actions }`. `reply` is every round's non-empty `text`, joined with
   `\n\n`, so narration like "Гаразд, створюю…" is not lost. If the model produced no text
   at all, fall back to a summary of the actions.

**Budget fully exhausted.** Step 2a forces the final `tools: []` round while
`MIN_ROUND_BUDGET_MS` of headroom still remains, so the normal path always gets to answer.
If even that round overruns and Bedrock throws, writes already committed in earlier rounds
**stand** — they were real side effects. Rather than surfacing `LlmUnavailableError` and
losing them, the route persists an assistant message whose `content` is the
action-summary fallback and whose `actions` carry what was done, so the user sees the
outcome. `LlmUnavailableError` still propagates unchanged when **no** round succeeded and
there is nothing to report.

Two contract details taken from the `claude-api` skill reference and enforced by the shape
above: **all** tool results for one assistant turn go back in a **single** user message
(splitting them trains the model out of parallel tool calls), and the assistant's full
content is appended verbatim rather than reconstructed from text.

Attachments are sent on the **first** round only — the model has already analyzed them by
round 2, and re-sending bytes each round would blow the token budget. This matches the
existing "prior turns are plain text" rule in `chat()`.

### The tool set

Nine tools. Descriptions are **prescriptive about when to call**, not just what the tool
does — the `claude-api` reference notes that recent Opus models reach for tools
conservatively and that trigger conditions in the description measurably lift call rate.

| Tool | Behavior |
|---|---|
| `create_reminder` | `CreateReminderSchema` → `assertReminderUnderCap` → `createReminder()` → `reminders.create`. Executes. |
| `update_reminder` | **Partial**: load existing (404 → error result), merge fields, re-parse `CreateReminderSchema`, `reminders.update`. Executes. |
| `delete_reminder` | **No write.** Records a pending action; returns "awaiting user confirmation". |
| `create_event` | `CreateEventSchema` → `createEvent()` → `events.create` + `bumpCarMileage`. Same semantics as `POST /cars/{id}/events`. Executes. |
| `update_event` | **Partial** merge over the existing event, re-parse, `events.update` + `bumpCarMileage`. (The REST `PUT` is full-replace; partial is what a model needs.) Executes. |
| `delete_event` | **No write.** Pending action; on confirm runs the existing proof cascade. |
| `update_car` | **Partial** merge over `CreateCarSchema` (mileage, nickname, plate, VIN, engine volume, …) → `cars.update`. Executes. |
| `search_events` | Pure read over the **full** timeline (`category?`, `from?`, `to?`, `text?`, `limit?`) — reaches past `MAX_CONTEXT_EVENTS = 60`. |
| `sum_spend` | Pure aggregate (`category?`, `from?`, `to?`) → totals per currency + a match count. |

`search_events` and `sum_spend` are **pure functions in `packages/domain`** over an
`Event[]`, so they are directly unit-testable; the executor passes the list it already
loaded for the context.

**Security.** `ownerId` and `carId` come from the authorized request context on every
repository call and are **never** read from tool input. The model can at most name an
entity id, and a wrong id fails the owner-scoped `getById` with a normal error result.
This is the same defense as the existing `chat/<owner>/<carId>/` attachment-prefix check.

**Zod is authority; JSON Schema only steers.** Each tool's `inputSchema` is hand-written
JSON Schema (as `EXTRACT_TOOL` already is, with the same "the domain use-case is the
authoritative validator" comment). The executor **re-parses every input with the real
contract schema** before writing. A Zod failure returns a tool result with `isError: true`
and the validation message, so the model can correct itself within the same turn.

### Tool results

Results are compact text, not JSON dumps — they re-enter the prompt on the next round:

- success → `Created reminder "Заміна оливи" (due at 259500 km). id=<uuid>`
- validation → `Invalid input: set dueDate or dueMileage`
- not found → `No reminder with that id for this car.`
- cap → `This car already has the maximum of 20 reminders.`
- pending delete → `Deletion of reminder "…" is awaiting the owner's confirmation in the chat. Do not retry.`

A thrown repository error is caught per-call and returned as `isError: true` so one failed
tool never fails the whole turn.

### Contracts: actions on a message

```ts
// packages/contracts/src/chat.ts
export const ChatActionKindSchema = z.enum([
  'create_reminder', 'update_reminder', 'delete_reminder',
  'create_event', 'update_event', 'delete_event', 'update_car',
]);

export const ChatActionStatusSchema = z.enum(['done', 'pending', 'declined', 'failed']);

export const PendingDeleteSchema = z.object({
  target: z.enum(['reminder', 'event']),
  entityId: z.string().uuid(),
});

export const ChatActionSchema = z.object({
  id: z.string().uuid(),
  kind: ChatActionKindSchema,
  status: ChatActionStatusSchema,
  summary: z.string().max(200),       // built by the executor from the entity's own data
  entityId: z.string().uuid().optional(),
  pending: PendingDeleteSchema.optional(),
});

StoredChatMessageSchema = ….extend({ actions: z.array(ChatActionSchema).max(10).default([]) });
```

`.default([])` keeps already-stored sessions forward-compatible — old messages parse with
an empty `actions` array and need no migration. Read tools produce **no** action (they are
not side effects); only writes and pending deletes do.

`summary` is assembled by the executor from the entity's own stored fields (its title,
category, due target) — the same data the History and Reminders tabs already display
untranslated. The UI localizes the surrounding labels and statuses via the `chat` i18n
namespace, not the summary text itself.

### Confirming a delete

The pending action is persisted on the assistant message, so a page reload does not lose
it. Two routes resolve it in **one** call each — server-side, so ownership is re-validated
and the status flip is atomic with the delete:

```
POST /cars/{id}/chat/sessions/{sid}/actions/{aid}/confirm → performs the delete, status='done'
POST /cars/{id}/chat/sessions/{sid}/actions/{aid}/decline  → status='declined'
```

Both return the updated `ChatSession`. Confirm is idempotent: an action already
`done`/`declined` returns 409 rather than deleting twice.

**Targeted refactor:** extract the event-delete proof cascade out of `event-routes.ts` into
a shared function so the confirm path and `DELETE /cars/{id}/events/{eventId}` share one
implementation instead of duplicating the cascade. Reminder delete needs no extraction (a
single repository call).

CDK: two new `httpApi.addRoutes` entries for the action paths.

### System prompt

The prompt changes character — from "answer only from the data below" to a tool policy:

- **Today's date is injected.** Reminders cannot be computed without it.
- Use tools to make changes the owner asks for; do not merely describe what you would do.
- **Never invent** a mileage, date, cost, or part number. If a required field is missing
  and cannot be derived from the records, **ask one short question** instead of guessing.
- Prefer the odometer/date already on record when the owner says "now"/"today".
- After acting, state plainly what was done.
- Deletions are proposed, not performed — say it is awaiting confirmation.
- Use `search_events`/`sum_spend` when the answer may lie outside the ~60 recent records shown.

The existing car + history + reminders block is kept as grounding.

### Cost note (flagged, not silently absorbed)

Each round re-sends the full system prompt, so a 3-round turn costs roughly 3× a current
single-call turn in input tokens. **Prompt caching is the fix and is available on Bedrock**
(`cache_control` on the system block). It is deliberately **out of scope here** and left as
a follow-up so this change stays reviewable; the system prompt is already built as one
block, which is the shape caching wants.

### Web

- `ChatBubble` renders an action list under the assistant text: a check + summary for
  `done`, a muted strikethrough for `declined`, a warning tint for `failed`, and for
  `pending` a card with **Confirm** / **Dismiss** buttons.
- `useConfirmChatAction` / `useDeclineChatAction` mutations write the returned session into
  the query cache (as `usePostChatMessage` already does) and invalidate the events and
  reminders queries so the History and Reminders tabs reflect what the chat just changed.
- Any turn carrying actions also invalidates events/reminders/car queries.
- New i18n keys in the `chat` namespace (en + uk) for the action labels, statuses, and
  confirm/dismiss.
- Empty-state suggestion chips gain one write-flavoured example so the capability is
  discoverable.

## Part 2 — Voice input

**Browser Web Speech API** (`webkitSpeechRecognition` / `SpeechRecognition`). No backend,
no upload, no audio leaves the device, no per-minute cost. Unsupported browsers simply do
not render the mic.

### `useSpeechRecognition()` hook

`apps/web/src/lib/useSpeechRecognition.ts`:

```ts
{ supported: boolean; listening: boolean; transcript: string; error: string | null;
  start(): void; stop(): void; }
```

- `lang` follows `i18n.language` → `uk-UA` / `en-US`; read at `start()` so a language switch
  takes effect on the next dictation.
- `continuous: true`, `interimResults: true`. Final results accumulate; the interim tail is
  appended live for display.
- **iOS Safari ends recognition on brief silence.** The hook auto-restarts on `onend`
  while the user has not tapped stop, so dictation doesn't die mid-sentence.
- `onerror`: `not-allowed` / `service-not-allowed` → a permission-denied message and
  `listening: false`; `no-speech` is ignored (the restart covers it).
- Cleans up on unmount (`stop()` + drop handlers) so a navigation away never leaves the
  mic hot.
- The hook **declares its own minimal `SpeechRecognition` interfaces** (they are absent
  from TS's DOM lib) rather than adding a `@types/dom-speech-recognition` dependency — and
  without `any`, per the project's strict-TS rule.

### Composer (Telegram-shaped)

The right-hand slot **swaps** mic ↔ send rather than showing both:

```
empty:      [📎]  Ask about this car…             [🎤]
listening:  [📎]  замінив оліву на двісті…   0:04 [⏹]   ← red, subtle pulse
has text:   [📎]  замінив оліву…                  [➤]
```

- Mic shows only when `supported && !input.trim() && files.length === 0`.
- While listening: the send/mic button becomes a red stop button with a `mm:ss` timer, and
  the transcript streams into the existing `TextField` — so it stays **fully editable**
  afterwards and the normal send path is unchanged.
- Stop keeps the text (it does not auto-send) — the user reviews, then sends.
- A permission error surfaces in the existing `Alert` slot used by `attachError`.
- `aria-label`s + `aria-pressed` on the mic; `aria-live` on the timer region.
- New i18n keys: `voiceStart`, `voiceStop`, `voiceListening`, `voiceDenied`,
  `voiceUnsupported`.

## Testing

**Domain (`packages/domain`)**
- The loop: single-round text answer; one tool call then a text answer; parallel tool calls
  in one round → a single `tool_results` entry; `MAX_MODEL_CALLS` cap forces a final
  `tools: []` call; a low clock budget forces the final round early; a pending delete
  produces an action and no write.
- `search_events` / `sum_spend`: category and date filtering, text match, limit, multiple
  currencies kept separate, empty timeline.

**API (`apps/api`)**
- Executor: partial-merge semantics for update tools; Zod failure → `isError` result, no
  write; reminder cap; unknown id → not-found result; `bumpCarMileage` side effect on event
  create.
- Ownership: a tool naming another owner's entity id resolves to not-found (nothing leaks).
- Confirm/decline routes: happy path deletes and flips status; double-confirm → 409;
  unknown action id → 404; event confirm cascades proofs.

**Web** — the hook's supported/unsupported branches and the composer's mic↔send swap are
covered by the existing lint/typecheck gates plus manual verification on iOS Safari and
desktop Chrome; there is no browser-speech test harness in the project and this design does
not add one.

## Out of scope

- Prompt caching for the multi-round prompt (follow-up; noted above).
- Async/polling turn execution — the bounded synchronous loop is the chosen model. If
  measured p95 approaches the cap, lifting the turn into the existing import-job pattern is
  the escape hatch.
- Server-side transcription (Amazon Transcribe) as an unsupported-browser fallback.
- Creating or deleting **cars** from chat, garage-wide (multi-car) tools, and reminder
  completion via chat.
- Text-to-speech / spoken replies.

## Decisions taken (confirmed 2026-08-04)

- Creates and updates execute immediately; **deletes require confirmation**.
- All four capability groups ship together: reminders, events, car details, read/query.
- Bounded **synchronous** loop, not async + polling.
- **Browser Web Speech API** for voice, not record-and-transcribe.
- `update_car` **may lower** the odometer — the existing REST route already permits it, so
  the chat is not made stricter than the form; the model simply has to say it did.