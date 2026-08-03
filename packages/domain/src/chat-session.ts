import type { StoredChatMessage } from '@carlog/contracts';

// A chat session as persisted (messages carry attachment *refs* — S3 keys — not bytes and
// not signed URLs). The API layer hydrates refs into signed-URL views before returning.
export type ChatSessionRecord = {
  id: string;
  carId: string;
  ownerId: string;
  title: string; // '' until the first user message; UI shows a localized "New chat" fallback
  messages: StoredChatMessage[];
  createdAt: string;
  updatedAt: string;
};

// Keep a session bounded so its DynamoDB item stays well under the 400 KB limit and the
// model prompt stays cheap. Oldest messages are dropped from the record on overflow.
export const SESSION_MESSAGE_CAP = 100;
const TITLE_MAX = 60;

// Derive a session title from the first user message: trimmed, whitespace-collapsed, and
// clipped. Returns '' for attachment-only (empty-text) first messages.
export function deriveTitle(content: string): string {
  const clean = content.trim().replace(/\s+/g, ' ');
  if (clean === '') return '';
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX)}…` : clean;
}

export function newChatSession(ownerId: string, carId: string, id: string, now: string): ChatSessionRecord {
  return { id, carId, ownerId, title: '', messages: [], createdAt: now, updatedAt: now };
}

// Append a message, capping history to the most recent SESSION_MESSAGE_CAP, bumping
// updatedAt, and titling the session from its first user turn. Pure — returns a new record.
export function appendMessage(session: ChatSessionRecord, message: StoredChatMessage, now: string): ChatSessionRecord {
  const messages = [...session.messages, message].slice(-SESSION_MESSAGE_CAP);
  const title = session.title === '' && message.role === 'user' ? deriveTitle(message.content) : session.title;
  return { ...session, messages, title, updatedAt: now };
}