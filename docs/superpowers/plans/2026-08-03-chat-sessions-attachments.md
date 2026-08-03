# AI Chat — Sessions + Attachments Implementation Plan

> Implements `docs/superpowers/specs/2026-08-03-chat-sessions-attachments-design.md`.

**Goal:** Persisted multi-session, multimodal per-car AI chat (7-day TTL; image/PDF attachments).

**Architecture:** Zod contracts → SDK-free domain (types, `ChatSessionRepository` port, `chat()` attachments) → thin API adapters (Dynamo/in-memory repos, routes, Bedrock provider) → CDK (routes + S3 lifecycle) → web (client, hooks, redesigned ChatPanel).

## Global Constraints
- Domain must not import the AWS SDK. Handlers thin. Zod = contract source of truth. Never `any`.
- Table TTL attribute is `ttl` (already configured). `ttl = floor(now/1000) + 7*86400`, refreshed on append.
- Attachments stored as S3 keys, never bytes. Only current-turn attachments sent to the model.
- Owner from JWT; every route validates ownership via `cars.getById`.
- Extension imports: extensionless (bundler/ nodenext? — match neighbours; api uses no `.js`).

---

### Task 1 — Contracts
Rewrite `packages/contracts/src/chat.ts`:
- `ChatAttachmentTypeSchema` = enum image/jpeg,png,webp + application/pdf (reuse scan's set).
- `AttachmentRefSchema = { key: string.min(1), contentType: ChatAttachmentTypeSchema, filename: optText, size: int.min(1) }`.
- `ChatAttachmentViewSchema = AttachmentRefSchema + { url: string.url() }`.
- `StoredChatMessageSchema = { role: enum(user,assistant), content: string.max(4000), attachments: AttachmentRef[].max(4).default([]), createdAt: datetime }`.
- `ChatMessageViewSchema` = message with `attachments: ChatAttachmentView[]`.
- `ChatSessionSchema = { id: uuid, carId: uuid, ownerId: min(1), title: string.max(120), messages: ChatMessageView[], createdAt, updatedAt }` (view form for GET).
- `ChatSessionSummarySchema = { id, title, updatedAt, messageCount: int }`.
- `PostMessageRequestSchema = { content: string.max(4000).default(''), attachments: AttachmentRef[].max(4).default([]) }` **.refine**(`content.trim() !== '' || attachments.length > 0`).
- `PostMessageResponseSchema = { reply: string, session: ChatSessionSchema }`.
- `ChatAttachmentPresignRequestSchema = { contentType: ChatAttachmentTypeSchema, size: int.min(1).max(MAX_SCAN_SIZE) }` (import MAX_SCAN_SIZE from ./import); `…ResponseSchema = { key, uploadUrl }`.
- Keep the plain `ChatMessage = {role,content}` type used by the provider port (add `attachments?` optional? No — provider takes attachments separately). Export all + types.
- Remove the old `ChatRequestSchema`/`ChatResponseSchema` (superseded).
- Test `chat.test.ts`: refine passes for attach-only, fails for empty+no-attach; max caps.

### Task 2 — Domain
- `llm-provider.ts`: change `chat(messages: ChatMessage[], context: CarChatContext, attachments: ChatAttachment[]): Promise<string>`; add `export type ChatAttachment = { base64: string; mediaType: string }`. `CarChatContext` unchanged.
- New `chat-session.ts`: `ChatSession` domain type (stored form: messages with attachment **refs**, not views), `newChatSession(ownerId, carId, id, now)`, `appendMessage(session, msg, now)` (pushes, caps to 100, sets updatedAt, derives title from first user msg if still default), `SESSION_MESSAGE_CAP = 100`, `deriveTitle(content)`.
- `chat-session-repository.ts`: `ChatSessionRepository` port (create/listByCar→summaries/getById/save/delete) + `ChatSessionSummary` re-type from contracts.
- `chat-about-car.ts`: `chatAboutCar(messages, llm, context, attachments)` passes attachments through. `buildCarChatContext` unchanged.
- index exports. Tests: `chat-session.test.ts` (append caps/title), keep existing.

### Task 3 — API repositories
- `dynamo-chat-session-repository.ts`: PK=`USER#<owner>`, SK=`CAR#<carId>#CHAT#<id>`; writes `ttl`; `listByCar` QueryCommand `begins_with(SK, 'CAR#<carId>#CHAT#')` → map to summaries (messageCount = messages.length); strips PK/SK/ttl on read.
- `in-memory-chat-session-repository.ts`: Map keyed `${owner}#${carId}#${id}`.
- Tests for in-memory lifecycle.

### Task 4 — API provider
- `BedrockLlmProvider.chat(messages, context, attachments)`: build final-user content from attachments (image/document blocks like `extractEventsFromDocument`) + text; render older attachment-bearing turns as `"[attachment: <n>] " + content` (the stored messages carry no attachments here — the adapter passes plain text history + current-turn base64; so simply: map messages to {role,content}, and if attachments.length, replace the LAST message content with a blocks array). effort low, max_tokens 1024.
- `InMemoryLlmProvider.chat(...)` signature update (ignores args, returns stub).

### Task 5 — API routes + wiring
- `chat-session-routes.ts` `handleChatRoute(deps, event, ownerId, carId)` matching `/cars/{carId}/chat*`:
  - `GET …/chat/sessions`, `POST …/chat/sessions`, `GET …/chat/sessions/{sid}`, `DELETE …/chat/sessions/{sid}`,
  - `POST …/chat/sessions/{sid}/messages` (load→append user→buildCtx→fetch current attachments base64 via `loadScanBase64`-like reader (generalize to `loadS3Base64(key)`)→`chatAboutCar`→append reply→refresh ttl→save→return {reply, session-with-signed-urls}),
  - `POST …/chat/attachments/presign` (validate, key `chat/<owner>/<carId>/<newId>.<ext>`, storage.presignPut).
  - Signed-url hydration: map stored refs → views via `storage.presignGet(key)`.
  - Attachment key guard: must start with `chat/<owner>/<carId>/`.
- `router.ts`: replace the single chat route dispatch with `if (id && path.startsWith(\`/cars/${id}/chat\`)) handleChatRoute(...)` passing `{cars, events, reminders, llm, sessions, storage, loadS3Base64, newId}`.
- `handler.ts`: instantiate `DynamoChatSessionRepository`, add `sessions`; generalize `loadScanBase64`→also usable for chat keys (rename to `loadS3Base64` or add param). `RouteDeps` gains `sessions: ChatSessionRepository`.
- `pathParams.sid` — HTTP API path param name `{sid}`.
- Update `router.test.ts`: swap old chat test for new session+message+presign tests; add in-memory sessions repo to deps.
- pathParams: CDK route `{sid}` must match.

### Task 6 — CDK
- Add S3 lifecycle rule `{ prefix: 'chat/', expiration: Duration.days(7) }` to `photosBucket`.
- Remove `POST /cars/{id}/chat`; add: `/cars/{id}/chat/sessions` [GET,POST], `/cars/{id}/chat/sessions/{sid}` [GET,DELETE], `/cars/{id}/chat/sessions/{sid}/messages` [POST], `/cars/{id}/chat/attachments/presign` [POST] — all with authorizer.

### Task 7 — Web api-client + queries
- api-client: `presignChatAttachment(token,carId,{contentType,size})`, `listChatSessions`, `createChatSession`, `getChatSession`, `deleteChatSession(token,carId,sid)`, `postChatMessage(token,carId,sid,{content,attachments})`. Schemas from contracts. Reuse `uploadToS3`.
- queries: `useChatSessions(carId)`, `useChatSession(carId,sid)`, `useCreateChatSession(carId)`, `useDeleteChatSession(carId)`, `usePostChatMessage(carId,sid)` (invalidate `['cars',carId,'chat']` list + `['cars',carId,'chat',sid]`).

### Task 8 — Web ChatPanel redesign (immersive view) + i18n
- Rewrite `ChatPanel`: **own header** `[← back][title ▾][+ new chat]` — back calls an `onBack`
  prop (`setTab('history')`); ▾ opens session switcher (Modal/sheet: list w/ relative time, select,
  rename, delete); + creates a new session. `?chat=<sid>` url state; default most-recent or fresh.
- Message list with attachment thumbnails/file chips (open signed url). Composer `[📎][textarea][send]`:
  📎 file picker accept image/*,application/pdf; downscale images via `prepareScanFile`; removable
  preview chips; send enabled when text OR attachments; Enter sends. On send: presign+upload each
  file, POST message with keys, append reply.
- Extend `chat` i18n (en/uk): sessions, newChat, rename, delete, deleteConfirm, attach, back,
  attachmentTooLarge, sending, empty title, etc.
- **Vehicle.tsx:** hide the desktop `Tabs` bar AND the mobile bottom nav (Paper + add button) when
  `tab === 'chat'`; pass `onBack={() => setTab('history')}` to `ChatPanel`. The chat panel renders
  full-bleed (no tab chrome). History/Reminders chrome unchanged.

### Task 9 — Gates + review
- `pnpm turbo run build lint typecheck test` green.
- Final adversarial review of the diff; fix Critical/Important.