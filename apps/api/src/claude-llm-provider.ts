import type Anthropic from '@anthropic-ai/sdk';
import type {
  LlmProvider, ExtractionContext, CarChatContext, ChatAttachment,
  ChatTurnEntry, ChatTurnResult, ChatToolDefinition, ChatToolChoice,
} from '@carlog/domain';
import { LlmUnavailableError } from './llm-errors';

// The one part of an SDK client this adapter uses. `Anthropic` (Claude API) and
// `AnthropicBedrock` (Amazon Bedrock) expose the same Messages API, so one adapter serves
// both providers; `create` is all either needs.
export type MessagesClient = { messages: Pick<Anthropic['messages'], 'create'> };

// The provider's own model id plus what the model accepts. `effort` is false for models
// that reject output_config.effort (Claude Haiku 4.5 400s on it).
export type ClaudeModelSpec = { id: string; effort: boolean };

export type ClaudeLlmProviderOptions = {
  client: MessagesClient;
  model: ClaudeModelSpec;
  // Names the provider in logs ("anthropic" / "bedrock").
  label: string;
};

// Claude Haiku 5.5 thinks adaptively by default; effort is the only depth control
// (default `medium`). Chat runs at `low`: up to three calls must fit the ~26s turn
// budget, and the replies are short. Extraction forces its tool call, which skips
// thinking, so its effort only shapes the tool input — `medium` keeps the works/parts
// mapping careful.
const CHAT_EFFORT = 'low';
const EXTRACT_EFFORT = 'medium';


// The tool schema mirrors the CandidateEvent shape so the model emits committable JSON.
// The domain use-case (extractEvents) is the authoritative validator — this schema only
// steers the model toward the right shape.
const EXTRACT_TOOL = {
  name: 'record_events',
  description: 'Return the maintenance events extracted from the text.',
  input_schema: {
    type: 'object' as const,
    properties: {
      events: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD. OMIT entirely only if no date is stated AND it cannot be estimated from mileage or from the surrounding records — never use today.' },
            mileage: { type: 'integer', description: 'odometer reading in km. OMIT entirely if the source does not state it — do not put 0.' },
            cost: { type: 'number', description: 'total cost, 0 if unknown' },
            currency: { type: 'string', description: 'ISO-ish code, default UAH' },
            category: { type: 'string', enum: ['oil_change', 'tires', 'brakes', 'inspection', 'repair', 'other'] },
            title: { type: 'string' },
            notes: { type: 'string' },
            works: {
              type: 'array',
              description: 'One entry per LABOR line / service performed (e.g. "Ремонт супорта", "Oil change"). NOT the parts — parts go inside each work\'s parts array.',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string', description: 'The labor/service performed, e.g. "Caliper repair".' },
                  parts: {
                    type: 'array',
                    description: 'Physical parts/materials used for this work (from the parts/Запчастини table).',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string', description: 'Part name, e.g. "Brake caliper repair kit".' },
                        brand: { type: 'string' },
                        partNumber: { type: 'string' },
                        quantity: { type: 'integer', description: 'Quantity, >= 1.' },
                        notes: { type: 'string' },
                      },
                      required: ['name', 'quantity'],
                    },
                  },
                },
                required: ['description'],
              },
            },
          },
          // Notes/documents are often partial: only the category is required. Omitted
          // mileage/cost default to 0; an omitted date stays blank for the user to fill
          // (the model is told to estimate from mileage when possible, never to use today).
          required: ['category'],
        },
      },
    },
    required: ['events'],
  },
};

// Shared extraction rules for both the text and the document (vision) paths. `source`
// names what's being read ("text" / "document") for the closing instruction.
function instructions(ctx: ExtractionContext, source: string): string {
  const { make, model, year } = ctx.car;
  const lines = [
    `You extract vehicle maintenance events from a ${source} for a ${year ?? ''} ${make} ${model}.`.trim(),
    'Return ONLY structured data via the record_events tool. Do not invent anything not in the source.',
    'A single document/note may cover SEVERAL services — return one event per distinct service.',
    '',
    'WORKS vs PARTS (important):',
    '- Each labor line / service performed is a WORK (its `description` = the service, e.g. "Caliper repair").',
    '- Physical parts, materials, fluids, and kits are PARTS nested inside the relevant work (name + quantity).',
    '- Do NOT dump parts into a work description or the event notes; put them in the parts array.',
    '- If a document has separate "parts" and "labor/works" tables, map the labor rows to works and',
    '  attach the parts rows to the most relevant work (or the single work if there is only one).',
    '',
    'FIELDS: use category "other" when unsure. OMIT any field the source does not state (mileage, cost,',
    'currency) rather than guessing.',
    '',
    'DATE:',
    '- If the source states a date, use it (YYYY-MM-DD).',
    '- If NO date is stated, estimate it. Prefer whichever signal is available:',
    '  (a) the neighbouring records in THIS source — a record sits between the dates of the entries',
    '      before and after it (the source is usually chronological); place it accordingly, and if only',
    '      a nearby month/year is known, use a plausible day within it.',
    '  (b) a mileage/odometer reading interpolated against the known service points below (assume roughly',
    '      linear mileage over time).',
    '  Output your best estimate as a full YYYY-MM-DD; approximate is fine.',
    '- Only if NEITHER neighbouring records NOR a usable mileage signal exists, OMIT the date entirely.',
    '  NEVER use today\'s date.',
  ];
  if (ctx.history && ctx.history.length > 0) {
    lines.push('', 'Known service points (date @ mileage km), newest first:');
    for (const h of ctx.history) lines.push(`- ${h.date} @ ${h.mileage} km`);
  }
  return lines.join('\n');
}

function prompt(text: string, ctx: ExtractionContext): string {
  return [instructions(ctx, 'free-form text'), '', 'TEXT:', text].join('\n');
}

// Serialize the car's grounding data into a system prompt. The instructions keep the
// model honest: answer only from these records, and admit gaps rather than invent.
function chatSystem(ctx: CarChatContext, today: string): string {
  const c = ctx.car;
  const lines = [
    'You are CarLog, an assistant for ONE specific vehicle. You can both answer questions',
    'about it and change its records using the provided tools.',
    '',
    `Today is ${today}.`,
    '',
    'RULES:',
    '- When the owner asks you to record, schedule, change, or correct something, USE THE',
    '  TOOLS to do it. Do not just describe what you would do.',
    '- NEVER invent a mileage, date, cost, or part number. If a required field is missing and',
    '  cannot be derived from the records below, ask ONE short question instead of guessing.',
    '- When the owner says "now" or "today", prefer the odometer and date already on record.',
    '- Deletions are proposed, not performed: say the deletion is awaiting their confirmation.',
    '- Use search_events or sum_spend when the answer may lie outside the recent records below.',
    '- After acting, state plainly what you did. Be concise; reply in plain text.',
    '- Keep every amount in the currency it is stored in.',
    '',
    'CAR:',
    `- ${[c.year, c.make, c.model].filter(Boolean).join(' ')}${c.nickname ? ` ("${c.nickname}")` : ''}`,
    `- Fuel: ${c.fuelType}${c.engineVolume ? `, ${c.engineVolume}L` : ''}`,
    `- Odometer: ${c.mileage > 0 ? `${c.mileage} km` : 'not recorded'}`,
  ];
  if (c.vin) lines.push(`- VIN: ${c.vin}`);
  if (c.licensePlate) lines.push(`- Plate: ${c.licensePlate}`);

  lines.push('', `SERVICE HISTORY (${ctx.events.length} records, newest first):`);
  if (ctx.events.length === 0) lines.push('- (no records yet)');
  for (const e of ctx.events) {
    const head = [
      e.date,
      e.category,
      e.mileage > 0 ? `${e.mileage} km` : null,
      e.cost > 0 ? `${e.cost} ${e.currency}` : null,
    ].filter(Boolean).join(' · ');
    lines.push(`- ${head}${e.title ? ` — ${e.title}` : ''} [id=${e.id}]`);
    if (e.notes) lines.push(`    note: ${e.notes}`);
    for (const w of e.works) {
      const parts = w.parts
        .map((p) => `${p.name}${p.brand ? ` (${p.brand})` : ''}×${p.quantity}`)
        .join(', ');
      lines.push(`    • ${w.description}${parts ? ` — ${parts}` : ''}`);
    }
  }

  lines.push('', `REMINDERS (${ctx.reminders.length}):`);
  if (ctx.reminders.length === 0) lines.push('- (none)');
  for (const r of ctx.reminders) {
    const due = [r.dueDate ? `by ${r.dueDate}` : null, r.dueMileage ? `at ${r.dueMileage} km` : null]
      .filter(Boolean).join(' / ');
    lines.push(`- ${r.title} (${r.category})${due ? ` — due ${due}` : ''}${r.notes ? ` — ${r.notes}` : ''} [id=${r.id}]`);
  }

  return lines.join('\n');
}


// Image and PDF attachments as Messages API content blocks. Media types are validated to
// the accepted set upstream; the SDK types image media as a narrow union, so assert here.
function fileBlock(base64: string, mediaType: string): Anthropic.ContentBlockParam {
  return mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType as Anthropic.Base64ImageSource['media_type'], data: base64 } };
}

function toolUseInput(res: Anthropic.Message): unknown {
  const toolUse = res.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
  return toolUse ? toolUse.input : null;
}

export class ClaudeLlmProvider implements LlmProvider {
  private readonly client: MessagesClient;
  private readonly model: ClaudeModelSpec;
  private readonly label: string;

  constructor(options: ClaudeLlmProviderOptions) {
    this.client = options.client;
    this.model = options.model;
    this.label = options.label;
  }

  // Sends `output_config.effort` only to models that accept it.
  private effort(level: 'low' | 'medium'): { output_config?: { effort: 'low' | 'medium' } } {
    return this.model.effort ? { output_config: { effort: level } } : {};
  }

  // Claude's safety classifiers can decline a request (HTTP 200, stop_reason 'refusal');
  // Claude Haiku 5.5 has no server-side fallback. Callers treat the declined output as
  // empty instead of reading partial content.
  private refused(where: string, res: Anthropic.Message): boolean {
    if (res.stop_reason !== 'refusal') return false;
    console.warn(`${this.label} ${where} refused`, JSON.stringify(res.stop_details ?? null));
    return true;
  }

  private async create(where: string, params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
    try {
      return await this.client.messages.create(params);
    } catch (err) {
      // Log the error class + message for diagnosis (bad key, model not found, throttling…).
      const e = err as Error;
      console.error(`${this.label} ${where} failed`, e.name, e.message);
      throw new LlmUnavailableError();
    }
  }

  // The smallest real request, for the admin "Test" button. Throws the SDK's own error so
  // the caller can tell a bad key from a missing model or an outage.
  async ping(): Promise<void> {
    await this.client.messages.create({
      model: this.model.id,
      // Room for any thinking before the one-word reply (thinking counts toward it).
      max_tokens: 256,
      ...this.effort('low'),
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
    });
  }

  async extractEvents(text: string, ctx: ExtractionContext): Promise<unknown> {
    const res = await this.create('extraction', {
      model: this.model.id,
      max_tokens: 16000,
      ...this.effort(EXTRACT_EFFORT),
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: 'record_events' },
      messages: [{ role: 'user', content: prompt(text, ctx) }],
    });
    // A refusal reads as shapeless output: the use-case retries once, then fails cleanly.
    if (this.refused('extraction', res)) return null;
    return toolUseInput(res);
  }

  async extractEventsFromDocument(base64: string, mediaType: string, ctx: ExtractionContext): Promise<unknown> {
    // Vision: images use an image block; PDFs use a document block. Same record_events
    // tool + parse as the text path.
    const promptText = instructions(ctx, 'maintenance invoice/receipt document');
    const res = await this.create('vision extraction', {
      model: this.model.id,
      max_tokens: 16000,
      ...this.effort(EXTRACT_EFFORT),
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: 'record_events' },
      messages: [{ role: 'user', content: [fileBlock(base64, mediaType), { type: 'text', text: promptText }] }],
    });
    if (this.refused('vision extraction', res)) return null;
    return toolUseInput(res);
  }

  // One model call in the domain's chat tool loop. Maps the neutral transcript onto
  // Messages API content blocks and maps the response back. Loop policy (round count,
  // time budget) lives in the domain use-case — this method makes exactly one call.
  async chatTurn(
    transcript: ChatTurnEntry[],
    context: CarChatContext,
    attachments: ChatAttachment[],
    tools: ChatToolDefinition[],
    toolChoice: ChatToolChoice,
  ): Promise<ChatTurnResult> {
    // Attach the current turn's files to the LAST user entry as vision blocks, mirroring
    // extractEventsFromDocument. Earlier turns stay plain text — their analysis already
    // lives in the assistant replies, and re-sending bytes would blow the cap. Every round
    // of this turn gets the same blocks: echoed thinking blocks are bound to the exact
    // prefix (system, tools, earlier messages) that produced them.
    const lastUserIdx = transcript.reduce(
      (found, entry, i) => (entry.role === 'user' ? i : found), -1,
    );
    const messages = transcript.map((entry, i): Anthropic.MessageParam => {
      if (entry.role === 'assistant') {
        // `raw` is this adapter's own content array from a previous round of the CURRENT
        // turn, echoed back UNCHANGED — modified thinking blocks are rejected.
        return { role: 'assistant', content: entry.raw as Anthropic.ContentBlockParam[] };
      }
      if (entry.role === 'assistant_text') {
        // A stored assistant reply replayed from conversation history — text only, no
        // provider `raw` to echo since it was persisted in DynamoDB, not produced in an
        // in-flight round of this turn.
        return { role: 'assistant', content: entry.content };
      }
      if (entry.role === 'tool_results') {
        return {
          role: 'user',
          content: entry.results.map((r): Anthropic.ToolResultBlockParam => ({
            type: 'tool_result',
            tool_use_id: r.id,
            content: r.content,
            is_error: r.isError,
          })),
        };
      }
      if (i === lastUserIdx && attachments.length > 0) {
        const blocks = attachments.map((a) => fileBlock(a.base64, a.mediaType));
        return { role: 'user', content: [...blocks, { type: 'text', text: entry.content }] };
      }
      return { role: 'user', content: entry.content };
    });

    // The domain's `inputSchema` is a plain JSON Schema object; the SDK types it as an
    // object schema with optional `properties`/`required`, which every chat tool has.
    const sdkTools = tools.map((t): Anthropic.Tool => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    const res = await this.create('chat', {
      model: this.model.id,
      // Headroom above a short answer plus any tool_use blocks; thinking counts toward it
      // too, which `low` effort keeps short — well inside the ~29s Lambda / 30s API
      // Gateway cap across a multi-round tool turn.
      max_tokens: 4096,
      ...this.effort(CHAT_EFFORT),
      system: chatSystem(context, new Date().toISOString().slice(0, 10)),
      // The final text-only round keeps the same tools and switches tool_choice to
      // 'none' — dropping `tools` would invalidate the echoed thinking blocks.
      ...(sdkTools.length > 0 ? { tools: sdkTools, tool_choice: { type: toolChoice } } : {}),
      messages,
    });

    // A declined round ends the loop with no text; the use-case falls back to its
    // canned reply (or the summaries of actions already taken this turn).
    if (this.refused('chat', res)) return { text: '', toolCalls: [], raw: res.content };

    const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('').trim();
    const toolCalls = res.content
      .filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
      .map((c) => ({ id: c.id, name: c.name, input: c.input }));
    return { text, toolCalls, raw: res.content };
  }
}
