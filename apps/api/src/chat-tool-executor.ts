import { z, ZodError } from 'zod';
import {
  CreateReminderSchema, CreateEventSchema, CreateCarSchema, EventCategorySchema, ChatActionSchema,
  MAX_REMINDERS_PER_CAR, type Car, type Event, type Reminder, type ChatAction, type ChatActionKind,
} from '@carlog/contracts';
import {
  createReminder, createEvent, bumpCarMileage, searchEvents, sumSpend,
  type CarRepository, type EventRepository, type ReminderRepository,
  type ChatToolExecutor, type ChatToolCall, type ChatToolOutcome,
} from '@carlog/domain';

export type ChatToolExecutorDeps = {
  cars: CarRepository;
  events: EventRepository;
  reminders: ReminderRepository;
  car: Car;            // the authorized car, as loaded when the route started the turn.
                        // Write paths must NOT read this for their base/merge state — see
                        // the re-read in dispatch() below — it may be stale by the time a
                        // later tool call in the same turn (or round) executes. It stays
                        // here only for context that isn't part of a write decision.
  timeline: Event[];    // the FULL event list, already loaded for the chat context
  ownerId: string;
  carId: string;
  newId: () => string;
};

// The contract cap (ChatActionSchema.summary is max(200)) — an over-long summary would
// persist and then fail ChatSessionSchema.parse on every subsequent read of the session.
const SUMMARY_MAX = 200;
const clamp = (summary: string): string =>
  summary.length <= SUMMARY_MAX ? summary : `${summary.slice(0, SUMMARY_MAX - 1)}…`;

const ok = (content: string, action?: ChatAction): ChatToolOutcome => ({ content, isError: false, action });
const fail = (content: string): ChatToolOutcome => ({ content, isError: true });

// Only WRITE tools map to a ChatActionKind. Read tools (search_events, sum_spend) and any
// unknown tool name are absent here, so a throw from those still produces NO action —
// there is nothing for a 'failed' row to represent for a read, and an unrecognized name
// isn't a real write attempt at all.
// Null prototype: a throw before dispatch()'s switch consults this map in the catch, and a
// bare literal would resolve prototype keys ('constructor', 'toString') to functions.
const WRITE_TOOL_KINDS: Partial<Record<string, ChatActionKind>> = Object.assign(Object.create(null), {
  create_reminder: 'create_reminder',
  update_reminder: 'update_reminder',
  delete_reminder: 'delete_reminder',
  create_event: 'create_event',
  update_event: 'update_event',
  delete_event: 'delete_event',
  update_car: 'update_car',
});

// Zod messages are what the model reads to correct itself, so surface the path too.
const zodMessage = (err: ZodError): string =>
  err.issues.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');

// Drop keys that mean "not provided". `undefined` is the JS-native omission; `null` is what
// models commonly send instead, since JSON has no `undefined` — both mean the same thing
// here, so a partial update merges instead of clearing (or rejecting) the field.
const defined = (input: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== null));

const asRecord = (input: unknown): Record<string, unknown> =>
  (typeof input === 'object' && input !== null ? { ...(input as Record<string, unknown>) } : {});

const reminderSummary = (r: Reminder): string => {
  const due = [r.dueDate ? `by ${r.dueDate}` : null, r.dueMileage ? `at ${r.dueMileage} km` : null]
    .filter(Boolean).join(' / ');
  return `${r.title}${due ? ` — due ${due}` : ''}`;
};

const eventSummary = (e: Event): string =>
  `${e.date} · ${e.category}${e.title ? ` — ${e.title}` : ''}${e.mileage > 0 ? ` (${e.mileage} km)` : ''}`;

// Executor-side validation for the read tools. These are NOT contract schemas (the read
// tools never write), just a guard so a wrong-typed input fails loudly instead of silently
// coercing into an empty, falsely-confident result (e.g. {limit:'many'} -> NaN -> slice(0,
// NaN) -> "No matching entries").
const ReadFiltersSchema = z.object({
  category: EventCategorySchema.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').optional(),
  text: z.string().optional(),
  limit: z.number().int().min(1).optional(),
});

// update_car's summary must only ever name fields the car contract actually accepts —
// Object.keys(defined(input)) alone would include unknown keys the model sent (or the model
// trying ownerId/carId overrides), which Zod strips silently on a passthrough-free object
// schema. Derived from the schema's own shape so this can't drift from CreateCarSchema.
const CAR_FIELD_NAMES = new Set(Object.keys(CreateCarSchema.shape));

// Executes the chat model's tool calls against the repositories. ownerId/carId always come
// from the authorized request context — NEVER from tool input — so the model can at most
// name an entity id, and a wrong id fails the owner-scoped lookup.
export class DomainChatToolExecutor implements ChatToolExecutor {
  constructor(private readonly deps: ChatToolExecutorDeps) {}

  async execute(call: ChatToolCall): Promise<ChatToolOutcome> {
    try {
      return await this.dispatch(call);
    } catch (err) {
      // A ZodError means the model sent bad input — it can retry within the same turn with
      // corrected input, potentially several times. Producing a 'failed' action row for
      // each retry would spam the UI with rows for something that never really happened, so
      // these deliberately produce NO action — only the non-Zod branch below does.
      if (err instanceof ZodError) return fail(`Invalid input: ${zodMessage(err)}`);
      // One failed tool must not fail the whole turn — report it so the model can adapt.
      console.error('chat tool failed', call.name, err);
      const kind = WRITE_TOOL_KINDS[call.name];
      const action = kind
        ? { id: this.deps.newId(), kind, status: 'failed' as const, summary: clamp(`Could not apply ${call.name}`) }
        : undefined;
      return { content: 'That operation failed. Tell the owner it did not go through.', isError: true, action };
    }
  }

  private action(kind: ChatActionKind, summary: string, entityId?: string): ChatAction {
    // Same guard as pending(): a malformed entityId (e.g. a legacy non-uuid row id) must
    // fail HERE as a tool error, not persist and brick the session on the next read.
    return ChatActionSchema.parse({ id: this.deps.newId(), kind, status: 'done', summary: clamp(summary), entityId });
  }

  // Validate the built action against the contract schema before handing it back to the
  // caller. `entityId` here is a tool-provided id that already passed an owner-scoped
  // `getById` lookup, so it is a real uuid today — but that invariant is easy to break by a
  // future caller, and an unvalidated non-uuid id would persist via the repository's
  // cast-not-parse write, then fail `ChatSessionSchema.parse` on every subsequent read of
  // the session (the brick-the-session class). A ZodError here propagates up through
  // `dispatch()` to `execute()`'s existing ZodError branch, which reports a tool error
  // instead of throwing.
  private pending(kind: ChatActionKind, target: 'reminder' | 'event', entityId: string, summary: string): ChatAction {
    return ChatActionSchema.parse({
      id: this.deps.newId(), kind, status: 'pending', summary: clamp(summary), entityId, pending: { target, entityId },
    });
  }

  // The car snapshot the executor was built with (deps.car) is captured once per turn, but
  // a round's tool calls run concurrently and a car-touching write is a full PUT. Re-reading
  // here means every write in the turn is based on the CURRENT stored car, not a snapshot
  // that a sibling call in the same round (or an earlier round) may have already moved past.
  // A null return means the car was deleted mid-turn by another request.
  private async loadCurrentCar(): Promise<Car | null> {
    return this.deps.cars.getById(this.deps.ownerId, this.deps.carId);
  }

  private async dispatch(call: ChatToolCall): Promise<ChatToolOutcome> {
    const { ownerId, carId } = this.deps;
    const input = asRecord(call.input);

    switch (call.name) {
      case 'create_reminder': {
        const existing = await this.deps.reminders.listByCar(ownerId, carId);
        // Bounded, low-stakes race: concurrent create_reminder calls within the SAME
        // Promise.all round can each read `existing` before any of them writes, so a
        // burst can overshoot MAX_REMINDERS_PER_CAR by a few. Not worth locking for —
        // it's capped by the round's tool-call count, and the REST route enforces the
        // same cap independently for form users, so the data can't run away unbounded.
        if (existing.length >= MAX_REMINDERS_PER_CAR) {
          return fail(`This car already has the maximum of ${MAX_REMINDERS_PER_CAR} reminders.`);
        }
        const parsed = CreateReminderSchema.parse(defined(input));
        const created = await this.deps.reminders.create(
          createReminder(ownerId, carId, parsed, { newId: this.deps.newId }),
        );
        const summary = reminderSummary(created);
        return ok(`Created reminder: ${summary}. id=${created.id}`,
          this.action('create_reminder', summary, created.id));
      }

      case 'update_reminder': {
        const { id, ...rest } = input;
        if (typeof id !== 'string') return fail('An existing reminder id is required.');
        const current = await this.deps.reminders.getById(ownerId, carId, id);
        if (!current) return fail('No reminder with that id for this car.');
        // Partial merge: strip the persisted-only fields, overlay the given ones, re-parse.
        const { id: _i, carId: _c, ownerId: _o, createdAt: _cr, updatedAt: _u, ...fields } = current;
        const parsed = CreateReminderSchema.parse({ ...fields, ...defined(rest) });
        const updated = await this.deps.reminders.update(ownerId, carId, id, parsed);
        const summary = reminderSummary(updated);
        return ok(`Updated reminder: ${summary}.`, this.action('update_reminder', summary, id));
      }

      case 'delete_reminder': {
        const { id } = input;
        if (typeof id !== 'string') return fail('An existing reminder id is required.');
        const current = await this.deps.reminders.getById(ownerId, carId, id);
        if (!current) return fail('No reminder with that id for this car.');
        const summary = `Delete reminder: ${reminderSummary(current)}`;
        return ok(
          `Deletion of reminder "${current.title}" is awaiting the owner's confirmation in the chat. Do not retry.`,
          this.pending('delete_reminder', 'reminder', id, summary),
        );
      }

      case 'create_event': {
        const parsed = CreateEventSchema.parse(defined(input));
        const created = await this.deps.events.create(
          createEvent(ownerId, carId, parsed, { newId: this.deps.newId }),
        );
        const car = await this.loadCurrentCar();
        if (!car) return fail('This car no longer exists.');
        const bumped = bumpCarMileage(car, created.mileage);
        if (bumped) await this.deps.cars.update(ownerId, carId, bumped);
        const summary = eventSummary(created);
        return ok(`Logged: ${summary}. id=${created.id}`,
          this.action('create_event', summary, created.id));
      }

      case 'update_event': {
        const { id, ...rest } = input;
        if (typeof id !== 'string') return fail('An existing event id is required.');
        const current = await this.deps.events.getById(ownerId, carId, id);
        if (!current) return fail('No timeline entry with that id for this car.');
        const { id: _i, carId: _c, ownerId: _o, createdAt: _cr, updatedAt: _u, ...fields } = current;
        const parsed = CreateEventSchema.parse({ ...fields, ...defined(rest) });
        const updated = await this.deps.events.update(ownerId, carId, id, parsed);
        const car = await this.loadCurrentCar();
        if (!car) return fail('This car no longer exists.');
        const bumped = bumpCarMileage(car, updated.mileage);
        if (bumped) await this.deps.cars.update(ownerId, carId, bumped);
        const summary = eventSummary(updated);
        return ok(`Updated: ${summary}.`, this.action('update_event', summary, id));
      }

      case 'delete_event': {
        const { id } = input;
        if (typeof id !== 'string') return fail('An existing event id is required.');
        const current = await this.deps.events.getById(ownerId, carId, id);
        if (!current) return fail('No timeline entry with that id for this car.');
        const summary = `Delete entry: ${eventSummary(current)}`;
        return ok(
          'Deletion of that entry is awaiting the owner\'s confirmation in the chat. Do not retry.',
          this.pending('delete_event', 'event', id, summary),
        );
      }

      case 'update_car': {
        const fields = defined(input);
        if (Object.keys(fields).length === 0) return fail('No car fields were given to change.');
        const car = await this.loadCurrentCar();
        if (!car) return fail('This car no longer exists.');
        // Odometer-lowering via update_car is intentionally allowed here (owner correcting
        // a typo) — bumpCarMileage's monotonicity guard is for event-derived readings only.
        const { id: _i, ownerId: _o, createdAt: _c, updatedAt: _u, shared: _s, ...current } = car;
        const parsed = CreateCarSchema.parse({ ...current, ...fields });
        // Build the summary only from keys the car contract actually accepts — Zod silently
        // drops unknown keys (and rejects an ownerId/carId override attempt via extra keys
        // being ignored, since parsed above is built from `current` + `fields` merged into
        // the exact CreateCarSchema shape), so a summary built from the raw input keys could
        // name fields that never changed anything.
        const changedKeys = Object.keys(fields).filter((k) => CAR_FIELD_NAMES.has(k));
        if (changedKeys.length === 0) return fail('No car fields were given to change.');
        const updated = await this.deps.cars.update(ownerId, carId, parsed);
        const summary = `Updated ${changedKeys.join(', ')} on ${updated.make} ${updated.model}`;
        return ok(`${summary}.`, this.action('update_car', summary, carId));
      }

      case 'search_events': {
        const parsedInput = ReadFiltersSchema.parse(defined(input));
        const found = searchEvents(this.deps.timeline, parsedInput);
        if (found.length === 0) return ok('No matching entries in the full history.');
        const lines = found.map((e) => {
          const cost = e.cost > 0 ? ` · ${e.cost} ${e.currency}` : '';
          const works = e.works.map((w) => w.description).join(', ');
          return `- ${eventSummary(e)}${cost}${works ? ` · ${works}` : ''} [id=${e.id}]`;
        });
        return ok(`${found.length} matching entries (newest first):\n${lines.join('\n')}`);
      }

      case 'sum_spend': {
        const { category, from, to } = ReadFiltersSchema.parse(defined(input));
        const { totals, count } = sumSpend(this.deps.timeline, { category, from, to });
        if (count === 0) return ok('No entries match, so nothing was spent on that.');
        const parts = totals.map((t) => `${t.total} ${t.currency}`).join(' + ');
        return ok(`${parts} across ${count} entr${count === 1 ? 'y' : 'ies'}.`);
      }

      default:
        return fail(`Unknown tool "${call.name}".`);
    }
  }
}
