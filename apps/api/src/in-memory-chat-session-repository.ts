import type { ChatSessionSummary } from '@carlog/contracts';
import { type ChatSessionRepository, type ChatSessionRecord } from '@carlog/domain';

export class InMemoryChatSessionRepository implements ChatSessionRepository {
  private sessions = new Map<string, ChatSessionRecord>();
  private key(ownerId: string, carId: string, sessionId: string) { return `${ownerId}#${carId}#${sessionId}`; }

  async create(session: ChatSessionRecord): Promise<ChatSessionRecord> {
    this.sessions.set(this.key(session.ownerId, session.carId, session.id), session);
    return session;
  }

  async listByCar(ownerId: string, carId: string): Promise<ChatSessionSummary[]> {
    return [...this.sessions.values()]
      .filter((s) => s.ownerId === ownerId && s.carId === carId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt, messageCount: s.messages.length }));
  }

  async getById(ownerId: string, carId: string, sessionId: string): Promise<ChatSessionRecord | null> {
    return this.sessions.get(this.key(ownerId, carId, sessionId)) ?? null;
  }

  async save(session: ChatSessionRecord): Promise<ChatSessionRecord> {
    this.sessions.set(this.key(session.ownerId, session.carId, session.id), session);
    return session;
  }

  async delete(ownerId: string, carId: string, sessionId: string): Promise<void> {
    this.sessions.delete(this.key(ownerId, carId, sessionId));
  }
}
