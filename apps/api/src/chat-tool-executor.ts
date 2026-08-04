import { ZodError } from 'zod';
import {
  CreateReminderSchema, CreateEventSchema, CreateCarSchema, MAX_REMINDERS_PER_CAR,
  type Car, type Event, type Reminder, type ChatAction, type ChatActionKind,
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
  car: Car;            // the authorized car, already loaded by the route
  timeline: Event[];    // the FULL event list, already loaded for the chat context
  ownerId: string;
  carId: string;
  newId: () => string;
};

const ok = (content: string, action?: ChatAction): ChatToolOutcome => ({ content, isError: false, action });
const fail = (content: string): ChatToolOutcome => ({ content, isError: true });

// Zod messages are what the model reads to correct itself, so surface the path too.
const zodMessage = (err: ZodError): string =>
  err.issues.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');

// Drop keys the model omitted so a partial update merges instead of clearing fields.
const defined = (input: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));

const asRecord = (input: unknown): Record<string, unknown> =>
  (typeof input === 'object' && input !== null ? { ...(input as Record<string, unknown>) } : {});

const reminderSummary = (r: Reminder): string => {
  const due = [r.dueDate ? `by ${r.dueDate}` : null, r.dueMileage ? `at ${r.dueMileage} km` : null]
    .filter(Boolean).join(' / ');
  return `${r.title}${due ? ` — due ${due}` : ''}`;
};

const eventSummary = (e: Event): string =>
  `${e.date} · ${e.category}${e.title ? ` — ${e.title}` : ''}${e.mileage > 0 ? ` (${e.mileage} km)` : ''}`;

// Executes the chat model's tool calls against the repositories. ownerId/carId always come
// from the authorized request context — NEVER from tool input — so the model can at most
// name an entity id, and a wrong id fails the owner-scoped lookup.
export class DomainChatToolExecutor implements ChatToolExecutor {
  constructor(private readonly deps: ChatToolExecutorDeps) {}

  async execute(call: ChatToolCall): Promise<ChatToolOutcome> {
    try {
      return await this.dispatch(call);
    } catch (err) {
      if (err instanceof ZodError) return fail(`Invalid input: ${zodMessage(err)}`);
      // One failed tool must not fail the whole turn — report it so the model can adapt.
      console.error('chat tool failed', call.name, err);
      return fail('That operation failed. Tell the owner it did not go through.');
    }
  }

  private action(kind: ChatActionKind, summary: string, entityId?: string): ChatAction {
    return { id: this.deps.newId(), kind, status: 'done', summary, entityId };
  }

  private pending(kind: ChatActionKind, target: 'reminder' | 'event', entityId: string, summary: string): ChatAction {
    return { id: this.deps.newId(), kind, status: 'pending', summary, entityId, pending: { target, entityId } };
  }

  private async dispatch(call: ChatToolCall): Promise<ChatToolOutcome> {
    const { ownerId, carId } = this.deps;
    const input = asRecord(call.input);

    switch (call.name) {
      case 'create_reminder': {
        const existing = await this.deps.reminders.listByCar(ownerId, carId);
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
        const bumped = bumpCarMileage(this.deps.car, created.mileage);
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
        const bumped = bumpCarMileage(this.deps.car, updated.mileage);
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
        const { id: _i, ownerId: _o, createdAt: _c, updatedAt: _u, shared: _s, ...current } = this.deps.car;
        const parsed = CreateCarSchema.parse({ ...current, ...fields });
        const updated = await this.deps.cars.update(ownerId, carId, parsed);
        const summary = `Updated ${Object.keys(fields).join(', ')} on ${updated.make} ${updated.model}`;
        return ok(`${summary}.`, this.action('update_car', summary, carId));
      }

      case 'search_events': {
        const found = searchEvents(this.deps.timeline, {
          category: input.category as Event['category'] | undefined,
          from: input.from as string | undefined,
          to: input.to as string | undefined,
          text: input.text as string | undefined,
          limit: input.limit as number | undefined,
        });
        if (found.length === 0) return ok('No matching entries in the full history.');
        const lines = found.map((e) => {
          const cost = e.cost > 0 ? ` · ${e.cost} ${e.currency}` : '';
          const works = e.works.map((w) => w.description).join(', ');
          return `- ${eventSummary(e)}${cost}${works ? ` · ${works}` : ''}`;
        });
        return ok(`${found.length} matching entries (newest first):\n${lines.join('\n')}`);
      }

      case 'sum_spend': {
        const { totals, count } = sumSpend(this.deps.timeline, {
          category: input.category as Event['category'] | undefined,
          from: input.from as string | undefined,
          to: input.to as string | undefined,
        });
        if (count === 0) return ok('No entries match, so nothing was spent on that.');
        const parts = totals.map((t) => `${t.total} ${t.currency}`).join(' + ');
        return ok(`${parts} across ${count} entr${count === 1 ? 'y' : 'ies'}.`);
      }

      default:
        return fail(`Unknown tool "${call.name}".`);
    }
  }
}
