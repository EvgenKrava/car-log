# AI Chat — Persisted Sessions + File Attachments (Redesign)

**Date:** 2026-08-03
**Status:** Approved

## Goal

Evolve the per-car AI chat from a single ephemeral conversation into **multiple
persisted sessions** (7-day DynamoDB TTL) with a **multimodal composer**: the user can
attach photos/PDFs (e.g. a service receipt) and ask Claude about them in the context of
the car's history ("when did we do this?"). Redesign the chat UI to modern best practices.

## Non-negotiable context (from the existing codebase)

- The DynamoDB table (`CarLogTable`) **already has `timeToLiveAttribute: 'ttl'`** — no CDK
  change needed for TTL; write a `ttl` epoch-seconds field on session rows.
- Single-table, `PK`/`SK`, PAY_PER_REQUEST. Owner from JWT (`ownerId`).
- The vision path already exists: `extractEventsFromDocument` sends base64 image/PDF blocks
  to Claude on Bedrock. Chat attachments reuse the same block shapes.
- `prepareScanFile` (web) already downscales images before upload — reuse it for attachments.
- The S3 bucket (`PhotosBucket`) already holds `scans/` (1-day lifecycle) and proofs. Add a
  `chat/` prefix with a **7-day** lifecycle to match session TTL.
- Domain stays SDK-free; handlers stay thin; Zod contracts are the source of truth.

## Data model

### ChatSession (one DynamoDB item per session)
- Key: `PK=USER#<owner>`, `SK=CAR#<carId>#CHAT#<sessionId>` (sessionId = uuid v4).
- Attributes: `{ id, carId, ownerId, title, messages: StoredChatMessage[], createdAt, updatedAt, ttl }`.
- `StoredChatMessage = { role: 'user'|'assistant', content: string, attachments?: StoredAttachment[], createdAt }`.
- `StoredAttachment = { key: string (S3), contentType, filename?, size }` — **keys, never bytes**.
- `ttl` = `floor(Date.now()/1000) + 7*86400`, **refreshed on every append**.
- Caps: keep ≤ 100 messages/session (drop oldest beyond that on write); ≤ 4 attachments/message.
- Title: derived from the first user message (trimmed to ~60 chars); "New chat" until then.

### Repository port (domain)
`ChatSessionRepository`:
- `create(session): Promise<ChatSession>`
- `listByCar(ownerId, carId): Promise<ChatSessionSummary[]>` (id/title/updatedAt/messageCount — no message bodies)
- `getById(ownerId, carId, sessionId): Promise<ChatSession | null>`
- `save(session): Promise<ChatSession>` (put; used for append)
- `delete(ownerId, carId, sessionId): Promise<void>`

Dynamo impl writes/reads the item + `ttl`; in-memory mirrors (tests). `listByCar` queries
`begins_with(SK, 'CAR#<carId>#CHAT#')` and projects summary fields.

## Backend routes (all authed; ownership validated via `cars.getById`)

Under `/cars/{id}/chat`:
- `GET  /cars/{id}/chat/sessions` → `ChatSessionSummary[]` (newest-updated first).
- `POST /cars/{id}/chat/sessions` → create empty session, returns it.
- `GET  /cars/{id}/chat/sessions/{sid}` → full `ChatSession` (messages; attachments carry a
  freshly-signed GET url for display).
- `DELETE /cars/{id}/chat/sessions/{sid}` → 204.
- `POST /cars/{id}/chat/sessions/{sid}/messages` — body `{ content, attachments?: {key,contentType,filename,size}[] }`:
  1. load session (404 if missing); validate attachment keys are under `chat/<owner>/<carId>/`.
  2. append the user message; build `CarChatContext` from car+events+reminders.
  3. fetch **current-turn** attachments' base64 from S3; call `llm.chat(messages, context, attachments)`.
  4. append the assistant reply; refresh `ttl`; save; return `{ reply, session }`.
  - Validation: reject empty `content` **and** empty `attachments` (nothing to send).
- `POST /cars/{id}/chat/attachments/presign` — body `{ contentType, size }` (image/*|application/pdf,
  ≤ scan max) → `{ key, uploadUrl }` with key `chat/<owner>/<carId>/<uuid>.<ext>`.

Route dispatch: a single `handleChatRoute` matching `/cars/{id}/chat*` (replaces the current
single-shot chat route). The old `POST /cars/{id}/chat` shape is removed.

## Provider change

`LlmProvider.chat(messages, context, attachments)` — `attachments: { base64, mediaType }[]`
(current turn only; `[]` when none). Bedrock impl: when attachments exist, the final user
message content becomes `[...imageOrDocumentBlocks, { type:'text', text }]` (mirroring
`extractEventsFromDocument`); prior turns are plain text. Older messages that *had*
attachments are rendered as `"[attachment: <filename>] <content>"` so the model knows one was
present. Empty registry `CHAT_TOOLS` seam unchanged. `effort: low`, `max_tokens: 1024`,
`thinking: adaptive`. Errors → `LlmUnavailableError` (503).

## Contracts (Zod)

- `AttachmentRefSchema = { key, contentType (image|pdf enum), filename?, size }`.
- `StoredChatMessageSchema`, `ChatSessionSchema`, `ChatSessionSummarySchema`.
- `PostMessageRequestSchema = { content: string.max(4000), attachments: AttachmentRef[].max(4) }`
  refined: `content.trim()` non-empty OR `attachments` non-empty.
- `ChatAttachmentPresignRequestSchema`/`ResponseSchema` (mirror scan presign).
- `PostMessageResponseSchema = { reply, session }`; message attachments in GET carry an added
  `url` (signed) via `ChatAttachmentViewSchema`.

## Frontend (mobile-first) — immersive chat view

**When the Chat tab is active, the vehicle tab bar is hidden** (both the desktop top `Tabs`
and the mobile floating bottom nav + its add button). Chat becomes a focused surface with its
own header, so the "+" affordance and session navigation live inside chat, not on the shared
tab chrome.

- **`api-client`:** `listChatSessions`, `createChatSession`, `getChatSession`, `deleteChatSession`,
  `postChatMessage`, `presignChatAttachment`. Reuse `uploadToS3` + `prepareScanFile`.
- **`queries`:** `useChatSessions(carId)`, `useChatSession(carId, sid)`, `useCreateChatSession`,
  `useDeleteChatSession`, `usePostChatMessage` (invalidates the session + list).
- **`ChatPanel` (redesigned):**
  - **Chat header:** `[ ← back ] [ session title ▾ ] [ + new chat ]`.
    - `←` returns to the History tab (`setTab('history')`) — the way out now that tabs are hidden.
    - `▾` opens a session **switcher** (bottom-sheet on mobile / menu on desktop): list of sessions
      with relative "updated" time, select-to-switch, per-session **rename** and **delete**.
    - `+` creates a **new session** and makes it active (this is the app's add affordance for the
      chat view — consistent placement, contextual action).
    - Active session id in `?chat=<sid>` (survives refresh); default = most-recent session, else a
      fresh empty one.
  - **Message list:** bubbles (user right / assistant left), attachment thumbnails (images) /
    file chips (pdf) with tap-to-open (signed url). Auto-scroll; typing indicator; error + retry.
  - **Composer:** `[ 📎 attach ] [ auto-grow textarea ] [ send ]`. 📎 opens the file picker
    (accept image/*,application/pdf); selected files show as removable preview chips above the
    input; images downscaled on pick. **Send enabled when text is non-empty OR ≥1 attachment.**
    Enter sends, Shift+Enter newlines. On send: presign+upload each attachment, then POST the
    message with the keys.
  - Empty state (no messages) keeps the suggested-prompt chips.
- **Vehicle.tsx:** hide the desktop `Tabs` bar and the mobile bottom nav (+ its add button) when
  `tab === 'chat'`; ChatPanel owns its own header/back. History/Reminders chrome unchanged.
- **i18n:** extend the `chat` namespace (sessions, newChat, rename/delete, attach, errors).

## CDK

- Add S3 lifecycle rule: prefix `chat/`, expiration 7 days.
- Register the new chat sub-routes (all with the JWT authorizer). Remove the single
  `POST /cars/{id}/chat` route (superseded by `…/sessions/{sid}/messages`).
- No new IAM (Dynamo RW, S3 RW/sign, Bedrock already granted).

## Testing

- Domain: `ChatSession` cap/title helpers; in-memory repo lifecycle (create/list/get/save/delete);
  `buildCarChatContext` unchanged (still owner-safe); `chatAboutCar` still delegates.
- API: session routes (create/list/get/delete; 404 non-owner; ttl set & refreshed); post-message
  (200 with reply; appends both turns; rejects empty content+no-attachments 400; validates
  attachment key prefix); presign (key prefix, type/size validation).
- Contracts: `PostMessageRequestSchema` refine (empty+no-attach fails; attach-only passes).
- Web: composer send-enabled logic (text OR attachment); session switcher basic render.

## Out of scope (later)

- Re-sending prior-turn attachment bytes to the model; streaming replies; cross-device session
  sync beyond DynamoDB; voice logging (separate, on the add flow); tools (web search) — the
  `CHAT_TOOLS` seam remains empty.