import Anthropic from '@anthropic-ai/sdk';
import type {
  AiSettings, AiTestError, AiTestResult, TestAiSettingsInput, UpdateAiSettingsInput,
} from '@carlog/contracts';
import type { AiSettingsStore, StoredAiSettings } from './ai-settings-store';
import type { AnthropicKeyStore } from './anthropic-key-store';
import type { ProviderFactory } from './llm-factory';
import { requireAdmin, type AdminActor } from './admin-service';

// Saving the Claude API as the provider with no key stored or given.
export class NoAnthropicKeyError extends Error {
  constructor() {
    super('Add a Claude API key before switching to the Claude API');
    this.name = 'NoAnthropicKeyError';
  }
}

export type AiSettingsDeps = {
  settings: AiSettingsStore;
  keys: AnthropicKeyStore;
  factory: ProviderFactory;
  // Called after a save so this Lambda instance applies the change at once.
  resolver: { invalidate(): void };
  now: () => Date;
};

export function toAiSettingsView(s: StoredAiSettings): AiSettings {
  return {
    provider: s.provider,
    model: s.model,
    anthropicKey: s.keyHint && s.keySetAt ? { hint: s.keyHint, setAt: s.keySetAt } : null,
    updatedAt: s.updatedAt,
  };
}

export async function getAiSettings(deps: AiSettingsDeps, actor: AdminActor): Promise<AiSettings> {
  requireAdmin(actor);
  return toAiSettingsView(await deps.settings.get());
}

export async function updateAiSettings(
  deps: AiSettingsDeps, actor: AdminActor, input: UpdateAiSettingsInput,
): Promise<AiSettings> {
  requireAdmin(actor);
  const current = await deps.settings.get();
  const hasKeyAfter = input.anthropicApiKey === undefined
    ? current.keyHint !== null
    : input.anthropicApiKey !== null;
  // Checked before anything is written, so a rejected save changes nothing.
  if (input.provider === 'anthropic' && !hasKeyAfter) throw new NoAnthropicKeyError();

  const now = deps.now().toISOString();
  let { keyHint, keySetAt } = current;
  if (typeof input.anthropicApiKey === 'string') {
    await deps.keys.put(input.anthropicApiKey);
    keyHint = input.anthropicApiKey.slice(-4);
    keySetAt = now;
  } else if (input.anthropicApiKey === null) {
    await deps.keys.remove();
    keyHint = null;
    keySetAt = null;
  }

  const next: StoredAiSettings = { provider: input.provider, model: input.model, keyHint, keySetAt, updatedAt: now };
  await deps.settings.save(next);
  deps.resolver.invalidate();
  return toAiSettingsView(next);
}

// Maps a provider error to what the admin can act on. The SDK's own message goes along
// as detail (e.g. Bedrock's "not available for this account"); it never contains the key.
function classify(err: unknown): { error: AiTestError; detail?: string } {
  const detail = err instanceof Error ? err.message.slice(0, 300) : undefined;
  const status = err instanceof Anthropic.APIError ? err.status : undefined;
  const error: AiTestError =
    status === 401 ? 'AUTH'
      : status === 403 ? 'FORBIDDEN'
        : status === 400 || status === 404 ? 'MODEL_UNAVAILABLE'
          : status === 429 ? 'RATE_LIMITED'
            : 'UNAVAILABLE';
  return detail ? { error, detail } : { error };
}

// Sends one tiny request with the given provider/model (and key, or the stored one), so
// the admin can check a choice before or after saving it. Costs a few tokens.
export async function testAiSettings(
  deps: AiSettingsDeps, actor: AdminActor, input: TestAiSettingsInput,
): Promise<AiTestResult> {
  requireAdmin(actor);
  let key: string | null = null;
  if (input.provider === 'anthropic') {
    key = input.anthropicApiKey ?? (await deps.keys.get());
    if (!key) return { ok: false, latencyMs: 0, error: 'NO_KEY' };
  }
  const startedAt = deps.now().getTime();
  try {
    await deps.factory(input.provider, input.model, key).ping();
    return { ok: true, latencyMs: Math.max(0, deps.now().getTime() - startedAt) };
  } catch (err) {
    return { ok: false, latencyMs: Math.max(0, deps.now().getTime() - startedAt), ...classify(err) };
  }
}
