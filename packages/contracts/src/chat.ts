import { z } from 'zod';
import { ScanDocContentTypeSchema, MAX_SCAN_SIZE, maxScanSize } from './import';

const optText = (s: z.ZodString) => z.literal('').transform(() => undefined).or(s.optional());

// A file the user attached to a chat message. Stored as an S3 key + metadata — never bytes.
// Content types match the scan/vision path (Claude can't decode HEIC).
export const AttachmentRefSchema = z.object({
  key: z.string().min(1),
  contentType: ScanDocContentTypeSchema,
  filename: optText(z.string().max(200)),
  size: z.number().int().min(1).max(MAX_SCAN_SIZE),
});

// The same attachment as returned to the client for display — plus a short-lived signed URL.
export const ChatAttachmentViewSchema = AttachmentRefSchema.extend({
  url: z.string().url(),
});

// A side effect the assistant performed (or proposed) during a turn. Persisted on the
// assistant message so a reload never loses a pending confirmation.
export const ChatActionKindSchema = z.enum([
  'create_reminder', 'update_reminder', 'delete_reminder',
  'create_event', 'update_event', 'delete_event', 'update_car',
]);

export const ChatActionStatusSchema = z.enum(['done', 'pending', 'declined', 'failed']);

// What a pending (unconfirmed) delete would remove, once the owner confirms.
export const PendingDeleteSchema = z.object({
  target: z.enum(['reminder', 'event']),
  entityId: z.string().uuid(),
});

export const ChatActionSchema = z.object({
  id: z.string().uuid(),
  kind: ChatActionKindSchema,
  status: ChatActionStatusSchema,
  // Built by the executor from the entity's own stored fields — the same untranslated
  // data the History/Reminders tabs show. The UI localizes only the labels around it.
  summary: z.string().max(200),
  entityId: z.string().uuid().optional(),
  pending: PendingDeleteSchema.optional(),
});

// One conversation turn as persisted. `attachments` are refs (keys); the client owns nothing.
export const StoredChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(4000),
  attachments: z.array(AttachmentRefSchema).max(4).default([]),
  // .default([]) keeps sessions written before this feature parseable — no migration.
  actions: z.array(ChatActionSchema).max(10).default([]),
  createdAt: z.string().datetime(),
});

// A turn as returned to the client (attachments carry signed URLs).
export const ChatMessageViewSchema = StoredChatMessageSchema.extend({
  attachments: z.array(ChatAttachmentViewSchema).max(4).default([]),
});

export const ChatSessionSchema = z.object({
  id: z.string().uuid(),
  carId: z.string().uuid(),
  ownerId: z.string().min(1),
  title: z.string().max(120),
  messages: z.array(ChatMessageViewSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Lightweight row for the session switcher — no message bodies.
export const ChatSessionSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(120),
  updatedAt: z.string().datetime(),
  messageCount: z.number().int().min(0),
});

// Append-a-message request: text, attachments, or both — but not neither.
export const PostMessageRequestSchema = z.object({
  content: z.string().max(4000).default(''),
  attachments: z.array(AttachmentRefSchema).max(4).default([]),
}).refine((r) => r.content.trim() !== '' || r.attachments.length > 0, {
  message: 'Provide a message or at least one attachment',
  path: ['content'],
});

export const PostMessageResponseSchema = z.object({
  reply: z.string(),
  session: ChatSessionSchema,
});

export const RenameSessionRequestSchema = z.object({
  title: z.string().min(1).max(120),
});

export const ChatAttachmentPresignRequestSchema = z.object({
  contentType: ScanDocContentTypeSchema,
  size: z.number().int().min(1).max(MAX_SCAN_SIZE),
}).refine((v) => v.size <= maxScanSize(v.contentType), { message: 'file too large for its type', path: ['size'] });

export const ChatAttachmentPresignResponseSchema = z.object({
  key: z.string().min(1),
  uploadUrl: z.string().url(),
});

export const TRANSCRIBE_AUDIO_MAX_B64 = 2_800_000; // ~60s of 16kHz mono 16-bit WAV, base64
export const TranscribeRequestSchema = z.object({
  audio: z.string().min(1).max(TRANSCRIBE_AUDIO_MAX_B64), // base64 WAV
  language: z.enum(['uk-UA', 'en-US']),
});
export const TranscribeResponseSchema = z.object({ text: z.string() });

export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;
export type ChatAttachmentView = z.infer<typeof ChatAttachmentViewSchema>;
export type ChatActionKind = z.infer<typeof ChatActionKindSchema>;
export type ChatActionStatus = z.infer<typeof ChatActionStatusSchema>;
export type PendingDelete = z.infer<typeof PendingDeleteSchema>;
export type ChatAction = z.infer<typeof ChatActionSchema>;
export type StoredChatMessage = z.infer<typeof StoredChatMessageSchema>;
export type ChatMessageView = z.infer<typeof ChatMessageViewSchema>;
export type ChatSession = z.infer<typeof ChatSessionSchema>;
export type ChatSessionSummary = z.infer<typeof ChatSessionSummarySchema>;
export type PostMessageRequest = z.infer<typeof PostMessageRequestSchema>;
export type PostMessageResponse = z.infer<typeof PostMessageResponseSchema>;
export type RenameSessionRequest = z.infer<typeof RenameSessionRequestSchema>;
export type ChatAttachmentPresignRequest = z.infer<typeof ChatAttachmentPresignRequestSchema>;
export type ChatAttachmentPresignResponse = z.infer<typeof ChatAttachmentPresignResponseSchema>;
export type TranscribeRequest = z.infer<typeof TranscribeRequestSchema>;
export type TranscribeResponse = z.infer<typeof TranscribeResponseSchema>;

// The minimal message shape the LLM provider consumes (role + text). Attachments for the
// current turn are passed to `chat()` separately as decoded bytes.
export type ChatMessage = { role: 'user' | 'assistant'; content: string };