import type { ChatToolCall, ChatToolDefinition } from './chat-tools';

export type ExtractionContext = {
  car: { make: string; model: string; year?: number };
  // Recent known (date, mileage) points from the car's existing timeline, newest first.
  // Used to estimate an event's date from a stated odometer reading when the document
  // gives no date. Empty/undefined when the car has no usable history.
  history?: { date: string; mileage: number }[];
};

// Sanitized snapshot of one car handed to the chat model as grounding context.
// Deliberately carries NO owner identifiers — only the car's own facts + timeline.
export type CarChatContext = {
  car: {
    make: string; model: string; year?: number; nickname?: string;
    fuelType: string; engineVolume?: number; mileage: number;
    vin?: string; licensePlate?: string;
  };
  events: {
    date: string; category: string; mileage: number; cost: number; currency: string;
    title?: string; notes?: string;
    works: { description: string; parts: { name: string; brand?: string; partNumber?: string; quantity: number; notes?: string }[] }[];
  }[];
  reminders: { title: string; category: string; dueDate?: string; dueMileage?: number; notes?: string }[];
};

// A decoded attachment for the current chat turn — base64 bytes + its MIME type. The API
// adapter fetches these from S3; the domain/provider never touches storage.
export type ChatAttachment = { base64: string; mediaType: string };

// One entry per model round, plus the tool results between rounds. The assistant entry
// carries `raw` — the provider's own content blocks, echoed back UNCHANGED on the next
// round (Bedrock rejects modified thinking blocks). The domain forwards it, never reads it.
export type ChatTurnEntry =
  | { role: 'user'; content: string }
  | { role: 'assistant'; raw: unknown }
  | { role: 'tool_results'; results: ChatToolResult[] };

export type ChatToolResult = { id: string; content: string; isError: boolean };

// The outcome of ONE model call in the tool loop. `toolCalls` empty ⇒ the turn is done.
export type ChatTurnResult = { text: string; toolCalls: ChatToolCall[]; raw: unknown };

export interface LlmProvider {
  // Returns the model's raw structured output as unknown JSON. The extractEvents
  // use-case validates it against the contract schema — the provider is NOT
  // responsible for schema conformance.
  extractEvents(text: string, ctx: ExtractionContext): Promise<unknown>;
  // Vision: read a maintenance document (image or PDF) and return raw structured output.
  extractEventsFromDocument(base64: string, mediaType: string, ctx: ExtractionContext): Promise<unknown>;
  // ONE model call in the chat tool loop. `transcript` is the conversation so far plus any
  // prior rounds of this turn; `attachments` are the current turn's decoded files (first
  // round only); `tools` is [] on the final forced-text round. Loop policy lives in the
  // domain use-case, not here.
  chatTurn(
    transcript: ChatTurnEntry[],
    context: CarChatContext,
    attachments: ChatAttachment[],
    tools: ChatToolDefinition[],
  ): Promise<ChatTurnResult>;
}
