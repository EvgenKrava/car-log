import { describe, expect, it } from 'vitest';
import { PostMessageRequestSchema, ChatAttachmentPresignRequestSchema } from './chat';

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
