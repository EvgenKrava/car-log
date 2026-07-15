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
            date: { type: 'string', description: 'YYYY-MM-DD; best estimate if partial' },
            mileage: { type: 'integer', description: 'odometer in km, 0 if unknown' },
            cost: { type: 'number', description: 'total cost, 0 if unknown' },
            currency: { type: 'string', description: 'ISO-ish code, default UAH' },
            category: { type: 'string', enum: ['oil_change', 'tires', 'brakes', 'inspection', 'repair', 'other'] },
            title: { type: 'string' },
            notes: { type: 'string' },
            works: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  parts: { type: 'array', items: { type: 'object' } },
                },
                required: ['description'],
              },
            },
          },
          required: ['date', 'mileage', 'cost', 'category'],
        },
      },
    },
    required: ['events'],
  },
};

function prompt(text: string, ctx: ExtractionContext): string {
  const { make, model, year } = ctx.car;
  return [
    `You extract vehicle maintenance events from free-form text for a ${year ?? ''} ${make} ${model}.`.trim(),
    'Return ONLY structured data via the record_events tool. Do not invent events that are not in the text.',
    'Use category "other" when unsure. Use 0 for unknown mileage/cost. Estimate the date as YYYY-MM-DD.',
    '',
    'TEXT:',
    text,
  ].join('\n');
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
}
