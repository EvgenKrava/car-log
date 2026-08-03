import type { ChatSessionSummary } from '@carlog/contracts';
import type { ChatSessionRecord } from './chat-session';

export interface ChatSessionRepository {
  create(session: ChatSessionRecord): Promise<ChatSessionRecord>;
  // Lightweight rows for the switcher (no message bodies), newest-updated first.
  listByCar(ownerId: string, carId: string): Promise<ChatSessionSummary[]>;
  getById(ownerId: string, carId: string, sessionId: string): Promise<ChatSessionRecord | null>;
  // Put — overwrites the whole session item (used for append). Refreshes TTL in the impl.
  save(session: ChatSessionRecord): Promise<ChatSessionRecord>;
  delete(ownerId: string, carId: string, sessionId: string): Promise<void>;
}