import { describe, expect, it } from 'vitest';
import type { StoredChatMessage } from '@carlog/contracts';
import { appendMessage, deriveTitle, newChatSession, SESSION_MESSAGE_CAP } from './chat-session';

const now = '2026-08-03T00:00:00.000Z';
const later = '2026-08-03T01:00:00.000Z';
const userMsg = (content: string, attachments: StoredChatMessage['attachments'] = []): StoredChatMessage =>
  ({ role: 'user', content, attachments, actions: [], createdAt: now });

describe('deriveTitle', () => {
  it('trims, collapses whitespace, and clips long text', () => {
    expect(deriveTitle('  hello   world  ')).toBe('hello world');
    expect(deriveTitle('x'.repeat(80))).toBe(`${'x'.repeat(60)}…`);
  });
  it('returns empty for attachment-only (empty) content', () => {
    expect(deriveTitle('   ')).toBe('');
  });
});

describe('appendMessage', () => {
  it('titles the session from the first user message and bumps updatedAt', () => {
    const s = appendMessage(newChatSession('u', 'c', 's', now), userMsg('When is my oil due?'), later);
    expect(s.title).toBe('When is my oil due?');
    expect(s.updatedAt).toBe(later);
    expect(s.messages).toHaveLength(1);
  });

  it('does not overwrite an existing title', () => {
    let s = appendMessage(newChatSession('u', 'c', 's', now), userMsg('first'), later);
    s = appendMessage(s, userMsg('second'), later);
    expect(s.title).toBe('first');
  });

  it('caps history at SESSION_MESSAGE_CAP, dropping the oldest', () => {
    let s = newChatSession('u', 'c', 's', now);
    for (let i = 0; i < SESSION_MESSAGE_CAP + 10; i++) s = appendMessage(s, userMsg(`m${i}`), later);
    expect(s.messages).toHaveLength(SESSION_MESSAGE_CAP);
    expect(s.messages[0]!.content).toBe('m10'); // m0..m9 dropped
  });
});