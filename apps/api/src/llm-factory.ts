import Anthropic from '@anthropic-ai/sdk';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import type { AiModel, AiProvider } from '@carlog/contracts';
import type { LlmProvider } from '@carlog/domain';
import { ClaudeLlmProvider } from './claude-llm-provider';
import { MODEL_SPECS } from './ai-models';

// A provider the admin "Test" button can also probe with one tiny request.
export type TestableLlmProvider = LlmProvider & { ping(): Promise<void> };

// Builds the provider for a saved (or proposed) choice. `apiKey` is required for
// 'anthropic' and ignored for 'bedrock'.
export type ProviderFactory = (provider: AiProvider, model: AiModel, apiKey: string | null) => TestableLlmProvider;

export class MissingAnthropicKeyError extends Error {
  constructor() {
    super('The Claude API is selected but no API key is stored');
    this.name = 'MissingAnthropicKeyError';
  }
}

// Bedrock uses SigV4 via the Lambda's own execution role (default AWS credential
// provider chain) — no bearer token, no cross-account IAM. BEDROCK_REGION lets the call
// target a different region than this Lambda's AWS_REGION if ever needed. One client per
// container: it holds no per-request state.
let bedrock: AnthropicBedrock | undefined;
const bedrockClient = (): AnthropicBedrock => {
  bedrock ??= new AnthropicBedrock({
    awsRegion: process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
  });
  return bedrock;
};

export const createClaudeProvider: ProviderFactory = (provider, model, apiKey) => {
  const spec = MODEL_SPECS[provider][model];
  if (provider === 'anthropic') {
    if (!apiKey) throw new MissingAnthropicKeyError();
    return new ClaudeLlmProvider({ client: new Anthropic({ apiKey }), model: spec, label: 'Claude API' });
  }
  return new ClaudeLlmProvider({ client: bedrockClient(), model: spec, label: 'Bedrock' });
};
