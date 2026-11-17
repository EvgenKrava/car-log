import { describe, it, expect, vi } from 'vitest';
import { LlmResolver, SwitchableLlmProvider } from './switchable-llm-provider';
import { InMemoryAiSettingsStore, InMemoryAnthropicKeyStore, stubProvider } from './in-memory-ai-settings';
import { INITIAL_AI_SETTINGS } from './ai-settings-store';
import { LlmUnavailableError } from './llm-errors';
import type { ProviderFactory } from './llm-factory';

const setup = () => {
  let t = 0;
  const settings = new InMemoryAiSettingsStore();
  const keys = new InMemoryAnthropicKeyStore();
  const factory = vi.fn<ProviderFactory>(() => stubProvider());
  const resolver = new LlmResolver({ settings, keys, factory, ttlMs: 1000, now: () => t });
  return { settings, keys, factory, resolver, advance: (ms: number) => { t += ms; } };
};

describe('LlmResolver', () => {
  it('builds the saved provider once and reuses it within the TTL', async () => {
    const { factory, resolver, advance } = setup();
    const first = await resolver.current();
    advance(999);
    expect(await resolver.current()).toBe(first);
    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith('bedrock', 'claude-haiku-4-5', null);
  });

  it('picks up a changed setting after the TTL', async () => {
    const { settings, keys, factory, resolver, advance } = setup();
    await resolver.current();
    settings.value = { ...INITIAL_AI_SETTINGS, provider: 'anthropic', model: 'claude-haiku-5-5', keyHint: 'abcd', keySetAt: 'x' };
    keys.value = 'the-key';
    advance(1000);
    await resolver.current();
    expect(factory).toHaveBeenLastCalledWith('anthropic', 'claude-haiku-5-5', 'the-key');
  });

  it('keeps the same provider (and client) when a refresh finds nothing changed', async () => {
    const { factory, resolver, advance } = setup();
    const first = await resolver.current();
    advance(5000);
    expect(await resolver.current()).toBe(first);
    expect(factory).toHaveBeenCalledOnce();
  });

  it('re-reads at once after invalidate()', async () => {
    const { settings, factory, resolver } = setup();
    await resolver.current();
    settings.value = { ...INITIAL_AI_SETTINGS, model: 'claude-haiku-5-5' };
    resolver.invalidate();
    await resolver.current();
    expect(factory).toHaveBeenLastCalledWith('bedrock', 'claude-haiku-5-5', null);
  });

  it('reads the key only when the Claude API is selected', async () => {
    const { keys, resolver } = setup();
    const get = vi.spyOn(keys, 'get');
    await resolver.current();
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps serving the previous provider when a refresh fails', async () => {
    const { settings, resolver, advance } = setup();
    const first = await resolver.current();
    vi.spyOn(settings, 'get').mockRejectedValue(new Error('throttled'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    advance(1000);
    expect(await resolver.current()).toBe(first);
  });

  it('fails as "AI unavailable" when nothing could ever be loaded', async () => {
    const { settings, resolver } = setup();
    vi.spyOn(settings, 'get').mockRejectedValue(new Error('no table'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(resolver.current()).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it('fails as "AI unavailable" when the Claude API is selected but the key is gone', async () => {
    const { settings, factory, resolver } = setup();
    settings.value = { ...INITIAL_AI_SETTINGS, provider: 'anthropic' };
    factory.mockImplementation((_p, _m, key) => { if (!key) throw new Error('missing key'); return stubProvider(); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(resolver.current()).rejects.toBeInstanceOf(LlmUnavailableError);
  });
});

describe('SwitchableLlmProvider', () => {
  it('sends each call to the currently selected provider', async () => {
    const a = { ...stubProvider(), extractEvents: vi.fn(async () => 'from-a') };
    const b = { ...stubProvider(), extractEvents: vi.fn(async () => 'from-b') };
    let current = a;
    const llm = new SwitchableLlmProvider({ current: async () => current });
    const ctx = { car: { make: 'VW', model: 'Golf' } };
    expect(await llm.extractEvents('t', ctx)).toBe('from-a');
    current = b;
    expect(await llm.extractEvents('t', ctx)).toBe('from-b');
  });
});
