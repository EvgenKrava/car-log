import { describe, it, expect } from 'vitest';
import {
  AnthropicApiKeySchema, UpdateAiSettingsSchema, TestAiSettingsSchema, AI_KEY_ERRORS,
} from './ai-settings';

const apiKey = `sk-ant-api03-${'a'.repeat(40)}`;

const messageOf = (input: unknown): string | undefined => {
  const res = AnthropicApiKeySchema.safeParse(input);
  return res.success ? undefined : res.error.issues[0]?.message;
};

describe('AnthropicApiKeySchema', () => {
  it('accepts a Console API key and trims surrounding whitespace', () => {
    expect(AnthropicApiKeySchema.parse(`  ${apiKey}\n`)).toBe(apiKey);
  });
  it('rejects a Pro/Max subscription token with its own code', () => {
    expect(messageOf(`sk-ant-oat01-${'b'.repeat(40)}`)).toBe(AI_KEY_ERRORS.subscriptionToken);
  });
  it('rejects anything else as an invalid key, with exactly one issue', () => {
    const res = AnthropicApiKeySchema.safeParse('hello');
    expect(res.success).toBe(false);
    expect(res.success ? [] : res.error.issues).toHaveLength(1);
    expect(messageOf('hello')).toBe(AI_KEY_ERRORS.invalid);
    expect(messageOf('sk-ant-api03-short')).toBe(AI_KEY_ERRORS.invalid);
  });
});

describe('UpdateAiSettingsSchema', () => {
  it('distinguishes keep (omitted), replace (string) and remove (null)', () => {
    expect(UpdateAiSettingsSchema.parse({ provider: 'bedrock', model: 'claude-haiku-4-5' }).anthropicApiKey).toBeUndefined();
    expect(UpdateAiSettingsSchema.parse({ provider: 'anthropic', model: 'claude-haiku-5-5', anthropicApiKey: apiKey }).anthropicApiKey).toBe(apiKey);
    expect(UpdateAiSettingsSchema.parse({ provider: 'bedrock', model: 'claude-haiku-4-5', anthropicApiKey: null }).anthropicApiKey).toBeNull();
  });
  it('rejects an unknown provider or model', () => {
    expect(() => UpdateAiSettingsSchema.parse({ provider: 'openai', model: 'claude-haiku-5-5' })).toThrow();
    expect(() => UpdateAiSettingsSchema.parse({ provider: 'anthropic', model: 'claude-opus-5-5' })).toThrow();
  });
});

describe('TestAiSettingsSchema', () => {
  it('does not accept null for the key (a test never removes it)', () => {
    expect(() => TestAiSettingsSchema.parse({ provider: 'anthropic', model: 'claude-haiku-5-5', anthropicApiKey: null })).toThrow();
  });
});
