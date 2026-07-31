import { z } from 'zod';

// One turn of the per-car chat. Role is limited to the two turns the client owns;
// tool/system turns are internal to the provider and never cross this boundary.
export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});

// The whole conversation is resent each turn (stateless backend). The last turn must
// be the user's — that's the message the model is being asked to answer.
export const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1).max(40),
}).refine((r) => r.messages[r.messages.length - 1]?.role === 'user', {
  message: 'The last message must be from the user',
  path: ['messages'],
});

export const ChatResponseSchema = z.object({
  reply: z.string(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;