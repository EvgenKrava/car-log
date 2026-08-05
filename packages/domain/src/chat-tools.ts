import type { ChatAction } from '@carlog/contracts';

// One tool call the model asked for. `input` is unknown by design: the API-side executor
// re-parses it with the authoritative Zod contract before any write.
export type ChatToolCall = { id: string; name: string; input: unknown };

// What one executed tool contributes back to the loop. `action` is present only for
// side effects (writes and proposed deletes) — read tools produce none.
export type ChatToolOutcome = { content: string; isError: boolean; action?: ChatAction };

// The port the domain loop calls to run a tool. Implemented in apps/api over the
// repositories, so the domain never touches persistence or the AWS SDK.
export interface ChatToolExecutor {
  execute(call: ChatToolCall): Promise<ChatToolOutcome>;
}

// Neutral JSON-Schema shape handed to the provider. It only STEERS the model toward the
// right input; the contract schema in the executor is the authoritative validator (same
// split as EXTRACT_TOOL in the Bedrock adapter).
export type ChatToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const CATEGORY = {
  type: 'string',
  enum: ['oil_change', 'tires', 'brakes', 'inspection', 'repair', 'other'],
  description: 'Maintenance category. Use "other" when unsure.',
};

const DATE = { type: 'string', description: 'Date as YYYY-MM-DD.' };

const REMINDER_FIELDS = {
  title: { type: 'string', description: 'Short label, e.g. "Engine oil + filters".' },
  category: CATEGORY,
  dueDate: { ...DATE, description: 'Calendar due date, YYYY-MM-DD. Set this, dueMileage, or both.' },
  dueMileage: { type: 'integer', description: 'Odometer target in km. Set this, dueDate, or both.' },
  repeatMonths: { type: 'integer', description: 'Repeat interval in months. Requires dueDate.' },
  repeatKm: { type: 'integer', description: 'Repeat interval in km (min 100). Requires dueMileage.' },
  notes: { type: 'string' },
};

const PARTS = {
  type: 'array',
  description: 'Physical parts, fluids, and materials used for this work.',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Part name, e.g. "Oil filter".' },
      brand: { type: 'string' },
      partNumber: { type: 'string' },
      quantity: { type: 'integer', description: 'Quantity, at least 1.' },
      notes: { type: 'string' },
    },
    required: ['name', 'quantity'],
  },
};

const WORKS = {
  type: 'array',
  description: 'One entry per service performed. Parts belong nested inside their work, never in notes.',
  items: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'The service performed, e.g. "Oil change".' },
      parts: PARTS,
    },
    required: ['description'],
  },
};

const EVENT_FIELDS = {
  date: { ...DATE, description: 'When the service happened, YYYY-MM-DD.' },
  mileage: { type: 'integer', description: 'Odometer reading in km at the time of service.' },
  cost: { type: 'number', description: 'Total cost. Use 0 when unknown.' },
  currency: { type: 'string', description: 'Currency code. Defaults to UAH.' },
  category: CATEGORY,
  title: { type: 'string' },
  notes: { type: 'string' },
  works: WORKS,
};

// The tools the chat model may call. Descriptions state WHEN to call — recent Opus models
// reach for tools conservatively, and trigger conditions measurably lift call rate.
export const CHAT_TOOLS: ChatToolDefinition[] = [
  {
    name: 'create_reminder',
    description:
      'Create a maintenance reminder for this car. Call this whenever the owner asks to be '
      + 'reminded, to schedule something, or to set up upcoming service. Requires a title, a '
      + 'category, and at least one of dueDate or dueMileage. Do not guess a due target — if '
      + 'neither can be derived from the records, ask the owner instead.',
    inputSchema: {
      type: 'object',
      properties: REMINDER_FIELDS,
      required: ['title', 'category'],
    },
  },
  {
    name: 'update_reminder',
    description:
      'Change an existing reminder. Call this when the owner wants to move a due date, adjust '
      + 'a mileage target, rename a reminder, or change its repeat interval. Only the fields '
      + 'you pass are changed; everything else is preserved. The id must come from the '
      + 'reminders listed in the context.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The reminder id.' }, ...REMINDER_FIELDS },
      required: ['id'],
    },
  },
  {
    name: 'delete_reminder',
    description:
      'Propose deleting a reminder. Call this when the owner asks to remove or cancel one. '
      + 'This does NOT delete it immediately — the owner must confirm in the chat first. Tell '
      + 'them it is awaiting their confirmation and do not call this tool again for the same id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The reminder id.' } },
      required: ['id'],
    },
  },
  {
    name: 'create_event',
    description:
      'Log a completed service into the car timeline. Call this when the owner says they had '
      + 'work done, replaced a part, or paid for maintenance. Requires a date, mileage, and '
      + 'category. Never invent a mileage, date, cost, or part number — ask if it is missing '
      + 'and cannot be derived from the records.',
    inputSchema: {
      type: 'object',
      properties: EVENT_FIELDS,
      required: ['date', 'mileage', 'category', 'cost'],
    },
  },
  {
    name: 'update_event',
    description:
      'Correct an existing timeline entry. Call this when the owner says a recorded date, '
      + 'mileage, cost, or description is wrong. Only the fields you pass are changed. Passing '
      + 'works replaces the whole works list, so include every work you want to keep.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The event id.' }, ...EVENT_FIELDS },
      required: ['id'],
    },
  },
  {
    name: 'delete_event',
    description:
      'Propose deleting a timeline entry. Call this when the owner asks to remove a record. '
      + 'This does NOT delete it immediately — the owner must confirm in the chat first, and '
      + 'confirming also removes the entry attachments. Say it is awaiting their confirmation.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The event id.' } },
      required: ['id'],
    },
  },
  {
    name: 'update_car',
    description:
      'Update this car own details. Call this when the owner reports a new odometer reading, '
      + 'or corrects the nickname, licence plate, VIN, engine volume, fuel type, make, model, '
      + 'or year. Only the fields you pass are changed. Say what you changed.',
    inputSchema: {
      type: 'object',
      properties: {
        mileage: { type: 'integer', description: 'Current odometer reading in km.' },
        nickname: { type: 'string' },
        licensePlate: { type: 'string' },
        vin: { type: 'string' },
        engineVolume: { type: 'number', description: 'Displacement in liters, e.g. 1.6.' },
        fuelType: {
          type: 'string',
          enum: ['petrol', 'diesel', 'electric', 'hybrid', 'lpg', 'other'],
        },
        make: { type: 'string' },
        model: { type: 'string' },
        year: { type: 'integer' },
      },
    },
  },
  {
    name: 'search_events',
    description:
      'Search this car FULL service history. Call this whenever the answer may depend on '
      + 'records older than the recent ones already shown in the context — for example a '
      + 'question about the first time something was done, or about a specific part across '
      + 'the whole history. Returns matching entries, newest first.',
    inputSchema: {
      type: 'object',
      properties: {
        category: CATEGORY,
        from: { ...DATE, description: 'Only entries on or after this date, YYYY-MM-DD.' },
        to: { ...DATE, description: 'Only entries on or before this date, YYYY-MM-DD.' },
        text: { type: 'string', description: 'Free text matched against titles, notes, works and parts.' },
        limit: { type: 'integer', description: 'Max entries to return (default 20, max 50).' },
      },
    },
  },
  {
    name: 'sum_spend',
    description:
      'Total what was spent on this car, optionally by category and date range. Call this for '
      + 'any "how much have I spent" question instead of adding costs up yourself, so older '
      + 'records outside the shown context are included. Totals are reported per currency.',
    inputSchema: {
      type: 'object',
      properties: {
        category: CATEGORY,
        from: { ...DATE, description: 'Only entries on or after this date, YYYY-MM-DD.' },
        to: { ...DATE, description: 'Only entries on or before this date, YYYY-MM-DD.' },
      },
    },
  },
];

export const CHAT_TOOL_NAMES: readonly string[] = CHAT_TOOLS.map((t) => t.name);
