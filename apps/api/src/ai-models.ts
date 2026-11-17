import type { AiModel, AiProvider } from '@carlog/contracts';
import type { ClaudeModelSpec } from './claude-llm-provider';

// Each selectable model's id on each provider, and whether it accepts
// output_config.effort. Bedrock serves these models only through cross-region inference
// profiles: a bare `anthropic.…` id 400s with "on-demand throughput isn't supported", and
// the `us.` prefix routes to whichever US region has capacity. Keep the Bedrock ids in
// sync with the Bedrock IAM policy in infrastructure/cdk/lib/carlog-stack.ts.
export const MODEL_SPECS: Record<AiProvider, Record<AiModel, ClaudeModelSpec>> = {
  anthropic: {
    'claude-haiku-5-5': { id: 'claude-haiku-5-5', effort: true },
    'claude-haiku-4-5': { id: 'claude-haiku-4-5', effort: false },
  },
  bedrock: {
    'claude-haiku-5-5': { id: 'us.anthropic.claude-haiku-5-5', effort: true },
    'claude-haiku-4-5': { id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', effort: false },
  },
};
