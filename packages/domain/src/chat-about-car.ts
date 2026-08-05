import type { Car, Event, Reminder, ChatMessage, ChatAction } from '@carlog/contracts';
import type {
  LlmProvider, CarChatContext, ChatAttachment, ChatTurnEntry, ChatToolResult, ChatTurnResult,
} from './llm-provider';
import { CHAT_TOOLS, type ChatToolExecutor, type ChatToolDefinition } from './chat-tools';

// Bound the timeline handed to the model so a large imported history can't inflate the
// prompt past the latency/token budget. The most recent events carry the most relevant
// context; older ones are dropped from the chat grounding (they remain in the timeline).
export const MAX_CONTEXT_EVENTS = 60;

// Build the grounding context for the chat from a car and its records. Pure and
// SDK-free; the guard against leaking identifiers lives here — the car's own identifiers
// and ownerId stay out entirely. Event and reminder ids ARE deliberately included: the
// model must be able to address a specific entity with the update/delete tools, and the
// executor's owner-scoped `getById` rejects any id that doesn't actually belong to this
// car/owner, so exposing these ids carries no cross-tenant risk.
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
        id: e.id,
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
      id: r.id,
      title: r.title,
      category: r.category,
      dueDate: r.dueDate,
      dueMileage: r.dueMileage,
      notes: r.notes,
    })),
  };
}

// Loop bounds. API Gateway hard-caps the HTTP integration at 30s regardless of the
// Lambda's own timeout, so the turn is bounded by wall-clock as well as round count.
export const MAX_MODEL_CALLS = 3;
export const TURN_BUDGET_MS = 26_000;
export const MIN_ROUND_BUDGET_MS = 8_000;

export type ChatTurnOutput = { reply: string; actions: ChatAction[] };
export type ChatAboutCarDeps = { now?: () => number };

const FALLBACK_REPLY = 'Sorry — I could not produce an answer from this car\'s records.';

// Mirrors the contract's `StoredChatMessage.content` cap (`z.string().max(4000)` in
// packages/contracts/src/chat.ts). The repository writes without re-validating, so an
// over-long reply would persist successfully but then fail `ChatSessionSchema.parse` on
// every subsequent read — permanently breaking the session in the UI with no recovery.
export const MAX_REPLY_CHARS = 4000;

// Clamp to the contract limit, preferring a whitespace boundary so we don't cut mid-word.
// Correctness of the `<= MAX_REPLY_CHARS` bound matters more than where exactly it cuts.
// Exported so callers building their own fallback reply (e.g. the route's
// interrupted-turn fallback) inherit the same contract-cap safety net.
export function clampReply(reply: string): string {
  if (reply.length <= MAX_REPLY_CHARS) return reply;
  const truncated = reply.slice(0, MAX_REPLY_CHARS);
  const lastSpace = truncated.lastIndexOf(' ');
  // Only trim to the space if that still leaves a reasonably-sized reply — otherwise a
  // reply with no whitespace near the boundary would get needlessly short.
  if (lastSpace > MAX_REPLY_CHARS - 200) return truncated.slice(0, lastSpace);
  return truncated;
}

// Mirrors the contract's `StoredChatMessage.actions` cap (`z.array(ChatActionSchema).max(10)`
// in packages/contracts/src/chat.ts). A round's tool calls execute concurrently and the loop
// runs multiple rounds, so a single turn can commit more than 10 actions (e.g. "log all 12
// services from my service book"). The repository writes without re-validating, so an
// over-cap actions array would persist successfully but then fail `ChatSessionSchema.parse`
// on every subsequent read — permanently breaking the session in the UI with no recovery.
export const MAX_TURN_ACTIONS = 10;

// Answer the latest user message, letting the model call tools to read and change this
// car's data. Bounded by MAX_MODEL_CALLS and TURN_BUDGET_MS: when either runs out the
// final call is made with no tools, so the model must answer in text.
export async function chatAboutCar(
  messages: ChatMessage[],
  llm: LlmProvider,
  context: CarChatContext,
  executor: ChatToolExecutor,
  attachments: ChatAttachment[] = [],
  deps: ChatAboutCarDeps = {},
): Promise<ChatTurnOutput> {
  if (messages.length === 0 || messages[messages.length - 1]!.role !== 'user') {
    throw new Error('chat requires a non-empty history ending in a user message');
  }
  const now = deps.now ?? Date.now;
  const startedAt = now();

  // Preserve each stored message's real role: a stored assistant reply becomes an
  // `assistant_text` entry (history, not part of an in-flight round), never a user turn —
  // otherwise the model reads its own prior words as something the owner said.
  const transcript: ChatTurnEntry[] = messages.map((m) => (
    m.role === 'assistant'
      ? { role: 'assistant_text', content: m.content }
      : { role: 'user', content: m.content }
  ));
  const texts: string[] = [];
  const actions: ChatAction[] = [];

  for (let round = 0; round < MAX_MODEL_CALLS; round += 1) {
    const isLastRound = round === MAX_MODEL_CALLS - 1;
    const remaining = TURN_BUDGET_MS - (now() - startedAt);
    // Offer tools only while there is room for a follow-up call to narrate the result.
    const tools: ChatToolDefinition[] =
      isLastRound || remaining < MIN_ROUND_BUDGET_MS ? [] : CHAT_TOOLS;

    // Bytes go on the first round only — by round 2 the model has already read them, and
    // re-sending them each round would blow the token budget.
    const turnAttachments = round === 0 ? attachments : [];

    let result: ChatTurnResult;
    try {
      result = await llm.chatTurn(transcript, context, turnAttachments, tools);
    } catch (err) {
      // Nothing committed yet ⇒ let the provider error surface as the usual 503.
      if (actions.length === 0) throw err;
      // Copy out (never hand the caller the live array the loop accumulates into) and slice
      // to the contract cap — see MAX_TURN_ACTIONS above.
      throw new ChatTurnInterruptedError(actions.slice(0, MAX_TURN_ACTIONS), err);
    }

    if (result.text.trim() !== '') texts.push(result.text.trim());
    transcript.push({ role: 'assistant', raw: result.raw });

    if (result.toolCalls.length === 0) break;
    // A tool-free round's only job is to produce the final text. If a provider returns
    // tool calls anyway on such a round, executing them would commit writes the loop can
    // never narrate back to the user (there is no further round to report the outcome).
    if (tools.length === 0) break;

    // Execute this round's calls concurrently, then return ALL results in ONE entry:
    // splitting them across entries trains the model out of parallel tool use.
    const outcomes = await Promise.all(result.toolCalls.map((call) => executor.execute(call)));
    const results: ChatToolResult[] = outcomes.map((outcome, i) => ({
      id: result.toolCalls[i]!.id,
      content: outcome.content,
      isError: outcome.isError,
    }));
    for (const outcome of outcomes) {
      if (outcome.action) actions.push(outcome.action);
    }
    transcript.push({ role: 'tool_results', results });
  }

  // The reply text narrates whatever the model said, independent of how many actions are
  // kept below — slicing the array never drops the narration, only the structured records
  // of actions past the contract cap (they still happened; only the pinned/confirm-card
  // metadata beyond the 10th is not persisted).
  const reply = clampReply(
    texts.join('\n\n').trim()
      || actions.map((a) => a.summary).join('\n').trim()
      || FALLBACK_REPLY,
  );
  return { reply, actions: actions.slice(0, MAX_TURN_ACTIONS) };
}

// Thrown when a round fails AFTER earlier rounds already committed writes. Carries what
// was done so the route can persist an assistant message instead of losing real side
// effects behind a 503. `cause` is the provider error.
export class ChatTurnInterruptedError extends Error {
  constructor(readonly actions: ChatAction[], override readonly cause: unknown) {
    super('chat turn interrupted after committing changes');
    this.name = 'ChatTurnInterruptedError';
  }
}
