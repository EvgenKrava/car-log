import { describe, expect, it } from 'vitest';
import {
  PostMessageRequestSchema,
  ChatAttachmentPresignRequestSchema,
  ChatActionSchema,
  StoredChatMessageSchema,
  TranscribeRequestSchema,
  TRANSCRIBE_AUDIO_MAX_B64,
} from './chat';

const attach = { key: 'chat/u/c/a.jpg', contentType: 'image/jpeg' as const, size: 1000 };

describe('PostMessageRequestSchema', () => {
  it('accepts text only', () => {
    expect(PostMessageRequestSchema.safeParse({ content: 'hi' }).success).toBe(true);
  });
  it('accepts an attachment with empty text', () => {
    expect(PostMessageRequestSchema.safeParse({ content: '', attachments: [attach] }).success).toBe(true);
  });
  it('rejects empty text and no attachments', () => {
    expect(PostMessageRequestSchema.safeParse({ content: '   ' }).success).toBe(false);
    expect(PostMessageRequestSchema.safeParse({}).success).toBe(false);
  });
  it('rejects more than 4 attachments', () => {
    expect(PostMessageRequestSchema.safeParse({ content: 'x', attachments: Array(5).fill(attach) }).success).toBe(false);
  });
});

describe('ChatAttachmentPresignRequestSchema', () => {
  it('accepts a small image and a pdf', () => {
    expect(ChatAttachmentPresignRequestSchema.safeParse({ contentType: 'image/png', size: 1000 }).success).toBe(true);
    expect(ChatAttachmentPresignRequestSchema.safeParse({ contentType: 'application/pdf', size: 1000 }).success).toBe(true);
  });
  it('rejects an oversize image (over the image cap) and heic', () => {
    expect(ChatAttachmentPresignRequestSchema.safeParse({ contentType: 'image/jpeg', size: 6_000_000 }).success).toBe(false);
    expect(ChatAttachmentPresignRequestSchema.safeParse({ contentType: 'image/heic', size: 1000 }).success).toBe(false);
  });
});

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

describe('TranscribeRequestSchema', () => {
  it('accepts a valid request', () => {
    expect(TranscribeRequestSchema.safeParse({ audio: 'aGVsbG8=', language: 'uk-UA' }).success).toBe(true);
  });
  it('rejects empty audio', () => {
    expect(TranscribeRequestSchema.safeParse({ audio: '', language: 'uk-UA' }).success).toBe(false);
  });
  it('rejects oversized audio', () => {
    expect(TranscribeRequestSchema.safeParse({
      audio: 'a'.repeat(TRANSCRIBE_AUDIO_MAX_B64 + 1), language: 'uk-UA',
    }).success).toBe(false);
  });
  it('rejects an unknown language', () => {
    expect(TranscribeRequestSchema.safeParse({ audio: 'aGVsbG8=', language: 'fr-FR' }).success).toBe(false);
  });
});
