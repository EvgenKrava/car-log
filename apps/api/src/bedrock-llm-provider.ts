import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import type {
  LlmProvider, ExtractionContext, CarChatContext, ChatAttachment,
  ChatTurnEntry, ChatTurnResult, ChatToolDefinition,
} from '@carlog/domain';
import { LlmUnavailableError } from './llm-errors';

// The Bedrock SDK's own entry point exports only the client classes (verified via
// `node -e "console.log(Object.keys(require('@anthropic-ai/bedrock-sdk')))"` →
// ['default', 'AnthropicBedrockMantle', 'BaseAnthropic', 'AnthropicBedrock']) — no
// ContentBlockParam, and no re-exported subpath for it either. `@anthropic-ai/sdk` (which
// does define it) is only a transitive dependency of this package, not a direct one, so
// its subpath types are not resolvable from our own source files. This local alias is the
// documented fallback for that gap — never widen `raw` to `any` instead.
type ContentBlockParam = Record<string, unknown>;

// Bare on-demand foundation-model id. The Bedrock-enabled account (677276119483) that
// issued our bearer token does NOT have the `global.`/`us.` cross-region inference
// profiles provisioned — verified live: `global.anthropic.claude-opus-4-8` 404s there,
// the bare id returns 200. Overridable via env so a deploy can target a different
// account's provisioned model/profile without a code change.
const MODEL = process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-opus-4-8';

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
    lines.push(`- ${head}${e.title ? ` — ${e.title}` : ''}`);
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
    lines.push(`- ${r.title} (${r.category})${due ? ` — due ${due}` : ''}${r.notes ? ` — ${r.notes}` : ''}`);
  }

  return lines.join('\n');
}

export class BedrockLlmProvider implements LlmProvider {
  // Auth via AWS_BEARER_TOKEN_BEDROCK env (a bearer token ISSUED BY the Bedrock-enabled
  // account — the token is self-identifying, so this reaches that account's Bedrock with
  // no cross-account IAM). The SDK auto-detects the env token. BEDROCK_REGION lets the
  // Bedrock region differ from this Lambda's own AWS_REGION (the issuing account may host
  // model access elsewhere); falls back to AWS_REGION, then us-east-1.
  private readonly client = new AnthropicBedrockMantle({
    awsRegion: process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
  });

  async extractEvents(text: string, ctx: ExtractionContext): Promise<unknown> {
    let res;
    try {
      res = await this.client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        // 'low' keeps the call inside the 29s Lambda cap (API GW hard-caps at 30s):
        // longer pasted notes at 'medium' ran past it and timed out. Extraction is a
        // structured-output task — it doesn't need deep reasoning.
        output_config: { effort: 'low' },
        tools: [EXTRACT_TOOL],
        tool_choice: { type: 'tool', name: 'record_events' },
        messages: [{ role: 'user', content: prompt(text, ctx) }],
      });
    } catch (err) {
      // Log the error class + message for diagnosis (model-not-found, throttling, etc.).
      // The Bedrock SDK's error message carries the status/model, NOT the bearer token, so
      // this does not leak the credential.
      const e = err as Error;
      console.error('Bedrock call failed', e.name, e.message);
      throw new LlmUnavailableError();
    }
    // Pull the tool-use input (the structured JSON) out of the response content.
    const toolUse = res.content.find((c: { type: string }) => c.type === 'tool_use');
    return toolUse && 'input' in toolUse ? toolUse.input : null;
  }

  async extractEventsFromDocument(base64: string, mediaType: string, ctx: ExtractionContext): Promise<unknown> {
    // Vision: images use an image block; PDFs use a document block (per the claude-api
    // skill's base64 content-block shapes). Same record_events tool + parse as the text path.
    // media_type is validated to SCAN_DOC_CONTENT_TYPES upstream; the SDK's image block
    // types it as a narrow union, so assert it here (runtime value is one of ours).
    const docBlock = mediaType === 'application/pdf'
      ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/webp', data: base64 } };
    const promptText = instructions(ctx, 'maintenance invoice/receipt document');
    let res;
    try {
      res = await this.client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' },
        tools: [EXTRACT_TOOL],
        tool_choice: { type: 'tool', name: 'record_events' },
        messages: [{ role: 'user', content: [docBlock, { type: 'text', text: promptText }] }],
      });
    } catch (err) {
      const e = err as Error;
      console.error('Bedrock vision call failed', e.name, e.message);
      throw new LlmUnavailableError();
    }
    const toolUse = res.content.find((c: { type: string }) => c.type === 'tool_use');
    return toolUse && 'input' in toolUse ? toolUse.input : null;
  }

  // One model call in the domain's chat tool loop. Maps the neutral transcript onto
  // Bedrock content blocks and maps the response back. Loop policy (round count, time
  // budget) lives in the domain use-case — this method makes exactly one call.
  async chatTurn(
    transcript: ChatTurnEntry[],
    context: CarChatContext,
    attachments: ChatAttachment[],
    tools: ChatToolDefinition[],
  ): Promise<ChatTurnResult> {
    // Attach the current turn's files to the LAST user entry as vision blocks, mirroring
    // extractEventsFromDocument. Earlier turns stay plain text — their analysis already
    // lives in the assistant replies, and re-sending bytes would blow the cap.
    const lastUserIdx = transcript.reduce(
      (found, entry, i) => (entry.role === 'user' ? i : found), -1,
    );
    const messages = transcript.map((entry, i) => {
      if (entry.role === 'assistant') {
        // `raw` is this adapter's own content array from a previous round of the CURRENT
        // turn, echoed back UNCHANGED — Bedrock rejects modified thinking blocks.
        return { role: 'assistant' as const, content: entry.raw as ContentBlockParam[] };
      }
      if (entry.role === 'assistant_text') {
        // A stored assistant reply replayed from conversation history — text only, no
        // provider `raw` to echo since it was persisted in DynamoDB, not produced in an
        // in-flight round of this turn.
        return { role: 'assistant' as const, content: entry.content };
      }
      if (entry.role === 'tool_results') {
        return {
          role: 'user' as const,
          content: entry.results.map((r) => ({
            type: 'tool_result' as const,
            tool_use_id: r.id,
            content: r.content,
            is_error: r.isError,
          })),
        };
      }
      if (i === lastUserIdx && attachments.length > 0) {
        const blocks = attachments.map((a) => a.mediaType === 'application/pdf'
          ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: a.base64 } }
          : { type: 'image' as const, source: { type: 'base64' as const, media_type: a.mediaType as 'image/jpeg' | 'image/png' | 'image/webp', data: a.base64 } });
        return { role: 'user' as const, content: [...blocks, { type: 'text' as const, text: entry.content }] };
      }
      return { role: 'user' as const, content: entry.content };
    });

    // `tools`/`messages` are built from the domain's neutral shapes (`inputSchema` is a plain
    // `Record<string, unknown>`; `messages` from the local ContentBlockParam alias — see the
    // comment atop this file). Both are structurally compatible with the SDK's own param
    // types but not the literal types TS infers here, so bridge via the SDK's own parameter
    // type — no `any`.
    type CreateParams = Parameters<typeof this.client.messages.create>[0];
    const bedrockTools = tools.length > 0
      ? tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) as unknown as NonNullable<CreateParams['tools']>
      : undefined;
    const bedrockMessages = messages as unknown as CreateParams['messages'];

    let res;
    try {
      res = await this.client.messages.create({
        model: MODEL,
        // Headroom above a short answer: adaptive thinking shares this budget with the
        // reply and any tool_use blocks.
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        // 'low' keeps each round well inside the ~29s Lambda / 30s API Gateway cap; a
        // tool turn makes several of these calls back to back.
        output_config: { effort: 'low' },
        system: chatSystem(context, new Date().toISOString().slice(0, 10)),
        ...(bedrockTools ? { tools: bedrockTools } : {}),
        messages: bedrockMessages,
      });
    } catch (err) {
      const e = err as Error;
      console.error('Bedrock chat failed', e.name, e.message);
      throw new LlmUnavailableError();
    }

    const text = res.content.map((c) => ('text' in c ? c.text : '')).join('').trim();
    const toolCalls = res.content
      .filter((c): c is Extract<typeof c, { type: 'tool_use' }> => c.type === 'tool_use')
      .map((c) => ({ id: c.id, name: c.name, input: c.input }));
    return { text, toolCalls, raw: res.content };
  }
}
