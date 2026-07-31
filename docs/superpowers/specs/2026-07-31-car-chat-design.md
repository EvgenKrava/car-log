# Per-Car AI Chat — Design

**Date:** 2026-07-31
**Status:** Approved

## Goal

Replace the removed Photos tab with an **"Ask about this car"** AI chat. v1 answers
questions grounded in the car's own data (details + service timeline + reminders).
The backend is architected so tools (web search, deeper history lookups, etc.) drop
in later without reshaping the call path.

## "RAG" model (no vector store)

A car's dataset is small (tens of events), so v1 **retrieves the whole car record +
events + reminders and injects it into the system prompt** — retrieval-augmented, but
plain context injection, no embeddings/store. One Claude call per user message → fits
the ~29s Lambda / 30s API Gateway cap.

## Backend

### Route
- `POST /cars/{id}/chat` (**authed**). Body `{ messages: ChatMessage[] }` — the full
  conversation so far (stateless; client resends each turn). Returns `{ reply: string }`.
- Ownership validated (owner from JWT); 404 if the car isn't the caller's.

### Layering
- **Contracts (Zod):** `ChatMessageSchema = { role: 'user' | 'assistant', content: string (1..4000) }`;
  `ChatRequestSchema = { messages: ChatMessage[] (1..40, last must be role 'user') }`;
  `ChatResponseSchema = { reply: string }`.
- **Domain:** extend the `LlmProvider` port with
  `chat(messages: ChatMessage[], context: CarChatContext): Promise<string>`.
  Add `CarChatContext` type (car identity + mileage + vin/plate + fuel/engine +
  events + reminders — all plain data). A framework-free use-case
  `chatAboutCar(messages, llm, context)` validates input and delegates to the provider.
  A pure `buildCarChatContext(car, events, reminders)` mapper (unit-tested) shapes the
  context object. Domain stays SDK-free.
- **API adapter:** `handleChatRoute` loads car + events + reminders, builds the context,
  calls `chatAboutCar`, returns the reply.

### Provider (`BedrockLlmProvider.chat`)
- `AnthropicBedrockMantle`, `anthropic.claude-opus-4-8`, `thinking: adaptive`,
  `output_config: { effort: 'low' }`, `max_tokens: 1024` (single reply → within cap).
- **System prompt** = base instructions + a serialized car context block. Instructions
  scope it: assistant for THIS car; answer from the provided records; state plainly when
  the data doesn't cover something (until web search exists); concise, plain-text.
- **Extensibility seam — tool registry, empty in v1.** `chat()` reads a `CHAT_TOOLS`
  registry (array of `{ definition, handler }`) and only passes a `tools` param when it's
  non-empty. v1 ships `CHAT_TOOLS = []`, so `chat()` is a single model call returning the
  reply text. Adding `web_search` / `get_more_history` later = register one entry and wrap
  the call in the standard `stop_reason === 'tool_use'` loop (localized to this method;
  the port, use-case, route, and UI are unchanged). We deliberately avoid importing the
  Anthropic SDK's param types here (they're a transitive dep, not a direct one). Errors →
  `LlmUnavailableError` (503), mirroring `extractEvents`.

### CDK
- Register `POST /cars/{id}/chat` with the JWT authorizer. No new IAM (Bedrock bearer
  token + existing perms already granted).

## Frontend

- **api-client:** `chatWithCar(token, carId, messages): Promise<{ reply }>`.
- **queries:** `useChatWithCar(carId)` mutation (no cache writes; chat state is local).
- **`ChatPanel` component:** scrolling message list (user right / assistant left),
  a composer (multiline input + send), pending/typing indicator, error toast on failure.
  Conversation lives in component state — **not persisted** across sessions in v1.
  An empty state with 2–3 suggested prompts ("How much have I spent on brakes?",
  "When's my next service likely due?", "Summarize this car for a buyer").
- **Vehicle.tsx:** third tab returns → **History / Chat / Reminders** (desktop Tabs +
  mobile bottom bar). The per-tab "+" add affordance is **hidden on the Chat tab**
  (chat has its own send button; `triggerAdd` unchanged for the other tabs).
- **i18n:** new `chat` namespace (en/uk).

## Testing

- `buildCarChatContext`: maps identity/mileage/vin/events/reminders; no owner fields leak
  into the context object.
- `chatAboutCar`: rejects empty history / non-user-last; passes context+messages to a fake
  provider and returns its reply.
- Chat route: 200 with reply for the owner; 404 for a car the caller doesn't own;
  validation 400 on a malformed body.
- Provider tool loop: with `CHAT_TOOLS = []` it makes exactly one call and returns text
  (fake Bedrock client).

## Out of scope (later)

- Streaming responses; persisted chat history; web-search & other tools (the seam is
  built, tools are not); voice logging (separate — lives on the add flow, not here).