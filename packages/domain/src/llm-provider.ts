import type { ChatMessage } from '@carlog/contracts';

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

export interface LlmProvider {
  // Returns the model's raw structured output as unknown JSON. The extractEvents
  // use-case validates it against the contract schema — the provider is NOT
  // responsible for schema conformance.
  extractEvents(text: string, ctx: ExtractionContext): Promise<unknown>;
  // Vision: read a maintenance document (image or PDF) and return raw structured output.
  extractEventsFromDocument(base64: string, mediaType: string, ctx: ExtractionContext): Promise<unknown>;
  // Answer the latest user message grounded in the car's own data. `messages` is the full
  // conversation so far (ending in a user turn); `attachments` are the current turn's decoded
  // files (image/PDF) to analyze, or `[]`. Returns the assistant's reply text.
  chat(messages: ChatMessage[], context: CarChatContext, attachments: ChatAttachment[]): Promise<string>;
}