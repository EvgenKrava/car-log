import type { AiSettingsStore, StoredAiSettings } from './ai-settings-store';
import { INITIAL_AI_SETTINGS } from './ai-settings-store';
import type { AnthropicKeyStore } from './anthropic-key-store';
import type { AiSettingsDeps } from './ai-settings-service';
import type { ProviderFactory, TestableLlmProvider } from './llm-factory';

// Test doubles for the AI settings ports.
export class InMemoryAiSettingsStore implements AiSettingsStore {
  constructor(public value: StoredAiSettings = INITIAL_AI_SETTINGS) {}
  async get(): Promise<StoredAiSettings> { return this.value; }
  async save(settings: StoredAiSettings): Promise<void> { this.value = settings; }
}

export class InMemoryAnthropicKeyStore implements AnthropicKeyStore {
  constructor(public value: string | null = null) {}
  async get(): Promise<string | null> { return this.value; }
  async put(key: string): Promise<void> { this.value = key; }
  async remove(): Promise<void> { this.value = null; }
}

// A provider whose AI methods are never expected to run in these tests; `ping` resolves
// unless `pingError` is given.
export function stubProvider(pingError?: unknown): TestableLlmProvider {
  const unused = async (): Promise<never> => { throw new Error('not used in this test'); };
  return {
    ping: async () => { if (pingError !== undefined) throw pingError; },
    extractEvents: unused,
    extractEventsFromDocument: unused,
    chatTurn: unused,
  };
}

export function inMemoryAiSettingsDeps(over?: Partial<AiSettingsDeps>): AiSettingsDeps {
  const factory: ProviderFactory = () => stubProvider();
  return {
    settings: new InMemoryAiSettingsStore(),
    keys: new InMemoryAnthropicKeyStore(),
    factory,
    resolver: { invalidate: () => {} },
    now: () => new Date('2026-11-17T10:00:00.000Z'),
    ...over,
  };
}
