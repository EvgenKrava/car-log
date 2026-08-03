import type { Car, Event, Reminder, ChatMessage } from '@carlog/contracts';
import type { LlmProvider, CarChatContext, ChatAttachment } from './llm-provider';

// Bound the timeline handed to the model so a large imported history can't inflate the
// prompt past the latency/token budget. The most recent events carry the most relevant
// context; older ones are dropped from the chat grounding (they remain in the timeline).
export const MAX_CONTEXT_EVENTS = 60;

// Build the grounding context for the chat from a car and its records. Pure and
// SDK-free; the guard against leaking owner fields lives here (only the car's own
// facts are copied — never ownerId, ids, or timestamps).
export function buildCarChatContext(car: Car, events: Event[], reminders: Reminder[]): CarChatContext {
  return {
    car: {
      make: car.make,
      model: car.model,
      year: car.year,
      nickname: car.nickname,
      fuelType: car.fuelType,
      engineVolume: car.engineVolume,
      mileage: car.mileage,
      vin: car.vin,
      licensePlate: car.licensePlate,
    },
    events: [...events]
      .sort((a, b) => (a.date < b.date ? 1 : -1)) // newest first
      .slice(0, MAX_CONTEXT_EVENTS)
      .map((e) => ({
        date: e.date,
        category: e.category,
        mileage: e.mileage,
        cost: e.cost,
        currency: e.currency,
        title: e.title,
        notes: e.notes,
        works: e.works.map((w) => ({
          description: w.description,
          parts: w.parts.map((p) => ({
            name: p.name,
            brand: p.brand,
            partNumber: p.partNumber,
            quantity: p.quantity,
            notes: p.notes,
          })),
        })),
      })),
    reminders: reminders.map((r) => ({
      title: r.title,
      category: r.category,
      dueDate: r.dueDate,
      dueMileage: r.dueMileage,
      notes: r.notes,
    })),
  };
}

// Answer the latest user message using the car context. Input is already validated at
// the contract boundary; the guard here is a defensive backstop for direct callers.
export async function chatAboutCar(
  messages: ChatMessage[], llm: LlmProvider, context: CarChatContext, attachments: ChatAttachment[] = [],
): Promise<string> {
  if (messages.length === 0 || messages[messages.length - 1]!.role !== 'user') {
    throw new Error('chat requires a non-empty history ending in a user message');
  }
  return llm.chat(messages, context, attachments);
}