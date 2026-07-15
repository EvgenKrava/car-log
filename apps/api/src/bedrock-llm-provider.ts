import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import type { LlmProvider, ExtractionContext } from '@carlog/domain';
import { LlmUnavailableError } from './llm-errors';

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
            date: { type: 'string', description: 'YYYY-MM-DD. OMIT entirely if the document states no date and it cannot be estimated from mileage — never use today.' },
            mileage: { type: 'integer', description: 'odometer in km; omit if unknown' },
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
    '- If NO date is stated but a mileage/odometer reading is, estimate the date by interpolating against',
    '  the known service points below (assume roughly linear mileage over time); output your best estimate.',
    '- If neither a date nor a usable mileage signal exists, OMIT the date entirely. NEVER use today\'s date.',
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
}
