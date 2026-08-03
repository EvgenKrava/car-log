import {
  PostMessageRequestSchema, RenameSessionRequestSchema, ChatAttachmentPresignRequestSchema,
  maxScanSize, type ChatSession, type ChatMessageView, type StoredChatMessage,
} from '@carlog/contracts';
import {
  CarNotFoundError, chatAboutCar, buildCarChatContext, newChatSession, appendMessage, nowIso,
  type CarRepository, type EventRepository, type ReminderRepository, type LlmProvider,
  type ChatSessionRepository, type ChatSessionRecord, type ChatAttachment, type PhotoStorage,
} from '@carlog/domain';
import type { Car } from '@carlog/contracts';
import { ok, type ApiResult } from './errors';
import type { ApiEvent } from './router';

export type ChatDeps = {
  cars: CarRepository;
  events: EventRepository;
  reminders: ReminderRepository;
  sessions: ChatSessionRepository;
  storage: PhotoStorage;
  llm: LlmProvider;
  loadS3Base64: (key: string) => Promise<string | null>;
  newId: () => string;
};

const ext = (contentType: string): string => (contentType === 'application/pdf' ? 'pdf' : contentType.split('/')[1] ?? 'bin');

// Hydrate stored attachment refs into display views with short-lived signed GET urls.
async function toSessionView(session: ChatSessionRecord, storage: PhotoStorage): Promise<ChatSession> {
  const messages: ChatMessageView[] = await Promise.all(session.messages.map(async (m) => ({
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
    attachments: await Promise.all(m.attachments.map(async (a) => ({ ...a, url: await storage.presignGet(a.key) }))),
  })));
  return {
    id: session.id, carId: session.carId, ownerId: session.ownerId, title: session.title,
    messages, createdAt: session.createdAt, updatedAt: session.updatedAt,
  };
}

// The text an attachment-bearing historical turn contributes to the model prompt (its bytes
// are not re-sent — only the current turn's are). Lets the model know a file was present.
function renderForModel(m: StoredChatMessage, isLast: boolean): string {
  if (isLast) {
    // Current user turn: the provider attaches the real bytes; give a default instruction
    // when the user sent a file with no text.
    return m.content.trim() !== '' ? m.content : (m.attachments.length > 0 ? 'Please analyze the attached file(s).' : m.content);
  }
  if (m.attachments.length === 0) return m.content;
  const names = m.attachments.map((a) => a.filename ?? `${a.contentType} file`).join(', ');
  return `[attached: ${names}] ${m.content}`.trim();
}

// Handles /cars/{carId}/chat* ; returns null if not matched.
export async function handleChatRoute(
  deps: ChatDeps, event: ApiEvent, ownerId: string, carId: string,
): Promise<ApiResult | null> {
  const { method, path, pathParams, body } = event;
  const base = `/cars/${carId}/chat`;
  if (!path.startsWith(base)) return null;

  const car: Car | null = await deps.cars.getById(ownerId, carId);
  if (!car) throw new CarNotFoundError(carId);

  // POST /chat/attachments/presign
  if (path === `${base}/attachments/presign` && method === 'POST') {
    const req = ChatAttachmentPresignRequestSchema.parse(body);
    const key = `chat/${ownerId}/${carId}/${deps.newId()}.${ext(req.contentType)}`;
    const uploadUrl = await deps.storage.presignPut(key, req.contentType, maxScanSize(req.contentType));
    return ok(200, { key, uploadUrl });
  }

  const sessionsBase = `${base}/sessions`;

  // GET /chat/sessions  |  POST /chat/sessions
  if (path === sessionsBase && method === 'GET') {
    return ok(200, await deps.sessions.listByCar(ownerId, carId));
  }
  if (path === sessionsBase && method === 'POST') {
    const session = await deps.sessions.create(newChatSession(ownerId, carId, deps.newId(), nowIso()));
    return ok(201, await toSessionView(session, deps.storage));
  }

  const sid = pathParams.sid;
  if (!sid) return ok(404, { error: 'NoRoute' });
  const sessionPath = `${sessionsBase}/${sid}`;
  const loadSession = async (): Promise<ChatSessionRecord | null> => deps.sessions.getById(ownerId, carId, sid);

  // GET /chat/sessions/{sid}
  if (path === sessionPath && method === 'GET') {
    const session = await loadSession();
    if (!session) return ok(404, { error: 'NotFound', message: 'session not found' });
    return ok(200, await toSessionView(session, deps.storage));
  }

  // PUT /chat/sessions/{sid}  (rename)
  if (path === sessionPath && method === 'PUT') {
    const { title } = RenameSessionRequestSchema.parse(body);
    const session = await loadSession();
    if (!session) return ok(404, { error: 'NotFound', message: 'session not found' });
    const renamed = await deps.sessions.save({ ...session, title, updatedAt: nowIso() });
    return ok(200, await toSessionView(renamed, deps.storage));
  }

  // DELETE /chat/sessions/{sid}
  if (path === sessionPath && method === 'DELETE') {
    await deps.sessions.delete(ownerId, carId, sid);
    return ok(204, null);
  }

  // POST /chat/sessions/{sid}/messages
  if (path === `${sessionPath}/messages` && method === 'POST') {
    const req = PostMessageRequestSchema.parse(body);
    const session = await loadSession();
    if (!session) return ok(404, { error: 'NotFound', message: 'session not found' });

    // Attachment keys must live under this owner's + car's chat prefix (defends against a
    // caller pointing at someone else's S3 object).
    const prefix = `chat/${ownerId}/${carId}/`;
    if (req.attachments.some((a) => !a.key.startsWith(prefix))) {
      return ok(400, { error: 'ValidationError', message: 'invalid attachment key' });
    }

    const userMsg: StoredChatMessage = { role: 'user', content: req.content, attachments: req.attachments, createdAt: nowIso() };
    const withUser = appendMessage(session, userMsg, nowIso());

    const [events, reminders] = await Promise.all([
      deps.events.listByCar(ownerId, carId),
      deps.reminders.listByCar(ownerId, carId),
    ]);
    const context = buildCarChatContext(car, events, reminders);

    // Decode the current turn's attachments for the model (skip any that fail to load).
    const decoded = await Promise.all(req.attachments.map(async (a): Promise<ChatAttachment | null> => {
      const base64 = await deps.loadS3Base64(a.key);
      return base64 ? { base64, mediaType: a.contentType } : null;
    }));
    const attachments = decoded.filter((a): a is ChatAttachment => a !== null);

    const llmMessages = withUser.messages.map((m, i) => ({
      role: m.role, content: renderForModel(m, i === withUser.messages.length - 1),
    }));

    const reply = await chatAboutCar(llmMessages, deps.llm, context, attachments);
    const assistantMsg: StoredChatMessage = { role: 'assistant', content: reply, attachments: [], createdAt: nowIso() };
    const saved = await deps.sessions.save(appendMessage(withUser, assistantMsg, nowIso()));
    return ok(200, { reply, session: await toSessionView(saved, deps.storage) });
  }

  return null;
}