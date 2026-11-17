import { z } from 'zod';

// Which backend serves the AI features (per-car chat, invoice scanning, text import).
// 'bedrock' calls Claude in this AWS account through the Lambda's own role; 'anthropic'
// calls the Claude API directly with an admin-supplied Console API key.
export const AiProviderSchema = z.enum(['bedrock', 'anthropic']);

// Provider-neutral model ids. The API maps each to the provider's own model id.
export const AiModelSchema = z.enum(['claude-haiku-5-5', 'claude-haiku-4-5']);

export type AiProvider = z.infer<typeof AiProviderSchema>;
export type AiModel = z.infer<typeof AiModelSchema>;

// In effect until an admin saves a choice — what production ran before the setting existed.
export const DEFAULT_AI_SETTINGS: { provider: AiProvider; model: AiModel } = {
  provider: 'bedrock',
  model: 'claude-haiku-4-5',
};

// Validation codes the admin UI translates. A Claude Pro/Max subscription token
// (sk-ant-oat…) is licensed for Claude Code and Claude's own apps only, so it can't back
// a service other people use; only Console API keys (sk-ant-api…) are accepted.
export const AI_KEY_ERRORS = {
  subscriptionToken: 'SUBSCRIPTION_TOKEN',
  invalid: 'INVALID_API_KEY',
} as const;

const API_KEY_RE = /^sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}$/;

export const AnthropicApiKeySchema = z.string().trim().superRefine((key, ctx) => {
  if (key.startsWith('sk-ant-oat')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: AI_KEY_ERRORS.subscriptionToken });
  } else if (!API_KEY_RE.test(key)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: AI_KEY_ERRORS.invalid });
  }
});

// What GET /admin/ai-settings returns. The key itself never leaves the server: the view
// carries only its last four characters and when it was set.
export const AiSettingsSchema = z.object({
  provider: AiProviderSchema,
  model: AiModelSchema,
  anthropicKey: z.object({ hint: z.string(), setAt: z.string() }).nullable(),
  updatedAt: z.string().nullable(),
});

export const UpdateAiSettingsSchema = z.object({
  provider: AiProviderSchema,
  model: AiModelSchema,
  // Omitted ⇒ keep the stored key; a string ⇒ replace it; null ⇒ remove it.
  anthropicApiKey: AnthropicApiKeySchema.nullable().optional(),
});

// Tests a provider/model pair before (or after) saving it. Without a key, the Claude API
// test uses the stored one.
export const TestAiSettingsSchema = z.object({
  provider: AiProviderSchema,
  model: AiModelSchema,
  anthropicApiKey: AnthropicApiKeySchema.optional(),
});

export const AiTestErrorSchema = z.enum([
  'NO_KEY', // Claude API selected but no key given or stored
  'AUTH', // key rejected
  'FORBIDDEN', // account not allowed to use the model (e.g. a 0 Bedrock quota)
  'MODEL_UNAVAILABLE', // model id unknown to the provider
  'RATE_LIMITED',
  'UNAVAILABLE', // anything else: network, 5xx, AWS credentials
]);

export const AiTestResultSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  error: AiTestErrorSchema.optional(),
  // The provider's own message, for the admin to read — never contains the key.
  detail: z.string().optional(),
});

export type AiSettings = z.infer<typeof AiSettingsSchema>;
export type UpdateAiSettingsInput = z.infer<typeof UpdateAiSettingsSchema>;
export type TestAiSettingsInput = z.infer<typeof TestAiSettingsSchema>;
export type AiTestError = z.infer<typeof AiTestErrorSchema>;
export type AiTestResult = z.infer<typeof AiTestResultSchema>;
