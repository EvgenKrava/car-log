import { describe, it, expect, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  getAiSettings, updateAiSettings, testAiSettings, NoAnthropicKeyError,
} from './ai-settings-service';
import { ForbiddenError, type AdminActor } from './admin-service';
import {
  InMemoryAiSettingsStore, InMemoryAnthropicKeyStore, inMemoryAiSettingsDeps, stubProvider,
} from './in-memory-ai-settings';
import { INITIAL_AI_SETTINGS } from './ai-settings-store';

const admin: AdminActor = { sub: 'admin-sub', isAdmin: true };
const member: AdminActor = { sub: 'user-sub', isAdmin: false };
const KEY = `sk-ant-api03-${'k'.repeat(36)}WXYZ`;

describe('getAiSettings', () => {
  it('returns the default (Bedrock, Haiku 4.5, no key) before anything is saved', async () => {
    expect(await getAiSettings(inMemoryAiSettingsDeps(), admin)).toEqual({
      provider: 'bedrock', model: 'claude-haiku-4-5', anthropicKey: null, updatedAt: null,
    });
  });
  it('rejects a non-admin', async () => {
    await expect(getAiSettings(inMemoryAiSettingsDeps(), member)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('updateAiSettings', () => {
  it('stores a new key in the key store and only its last four characters in settings', async () => {
    const settings = new InMemoryAiSettingsStore();
    const keys = new InMemoryAnthropicKeyStore();
    const invalidate = vi.fn();
    const view = await updateAiSettings(
      inMemoryAiSettingsDeps({ settings, keys, resolver: { invalidate } }), admin,
      { provider: 'anthropic', model: 'claude-haiku-5-5', anthropicApiKey: KEY },
    );
    expect(keys.value).toBe(KEY);
    expect(view).toEqual({
      provider: 'anthropic', model: 'claude-haiku-5-5',
      anthropicKey: { hint: 'WXYZ', setAt: '2026-11-17T10:00:00.000Z' },
      updatedAt: '2026-11-17T10:00:00.000Z',
    });
    expect(JSON.stringify(settings.value)).not.toContain(KEY);
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('keeps the stored key when the update omits it', async () => {
    const settings = new InMemoryAiSettingsStore({ ...INITIAL_AI_SETTINGS, keyHint: 'WXYZ', keySetAt: '2026-11-01T00:00:00.000Z' });
    const keys = new InMemoryAnthropicKeyStore(KEY);
    const view = await updateAiSettings(inMemoryAiSettingsDeps({ settings, keys }), admin,
      { provider: 'anthropic', model: 'claude-haiku-4-5' });
    expect(keys.value).toBe(KEY);
    expect(view.anthropicKey).toEqual({ hint: 'WXYZ', setAt: '2026-11-01T00:00:00.000Z' });
  });

  it('removes the key on null', async () => {
    const settings = new InMemoryAiSettingsStore({ ...INITIAL_AI_SETTINGS, keyHint: 'WXYZ', keySetAt: '2026-11-01T00:00:00.000Z' });
    const keys = new InMemoryAnthropicKeyStore(KEY);
    const view = await updateAiSettings(inMemoryAiSettingsDeps({ settings, keys }), admin,
      { provider: 'bedrock', model: 'claude-haiku-4-5', anthropicApiKey: null });
    expect(keys.value).toBeNull();
    expect(view.anthropicKey).toBeNull();
  });

  it('refuses the Claude API without a key and writes nothing', async () => {
    const settings = new InMemoryAiSettingsStore();
    const deps = inMemoryAiSettingsDeps({ settings });
    await expect(updateAiSettings(deps, admin, { provider: 'anthropic', model: 'claude-haiku-5-5' }))
      .rejects.toBeInstanceOf(NoAnthropicKeyError);
    expect(settings.value).toBe(INITIAL_AI_SETTINGS);
  });

  it('refuses removing the key while keeping the Claude API selected', async () => {
    const settings = new InMemoryAiSettingsStore({ ...INITIAL_AI_SETTINGS, provider: 'anthropic', keyHint: 'WXYZ', keySetAt: 'x' });
    const keys = new InMemoryAnthropicKeyStore(KEY);
    await expect(updateAiSettings(inMemoryAiSettingsDeps({ settings, keys }), admin,
      { provider: 'anthropic', model: 'claude-haiku-5-5', anthropicApiKey: null })).rejects.toBeInstanceOf(NoAnthropicKeyError);
    expect(keys.value).toBe(KEY);
  });

  it('rejects a non-admin before touching anything', async () => {
    const keys = new InMemoryAnthropicKeyStore();
    await expect(updateAiSettings(inMemoryAiSettingsDeps({ keys }), member,
      { provider: 'anthropic', model: 'claude-haiku-5-5', anthropicApiKey: KEY })).rejects.toBeInstanceOf(ForbiddenError);
    expect(keys.value).toBeNull();
  });
});

describe('testAiSettings', () => {
  it('reports NO_KEY for the Claude API with no key given or stored', async () => {
    const factory = vi.fn(() => stubProvider());
    const res = await testAiSettings(inMemoryAiSettingsDeps({ factory }), admin, { provider: 'anthropic', model: 'claude-haiku-5-5' });
    expect(res).toEqual({ ok: false, latencyMs: 0, error: 'NO_KEY' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('uses the stored key when none is given, and the given key over the stored one', async () => {
    const factory = vi.fn(() => stubProvider());
    const deps = inMemoryAiSettingsDeps({ factory, keys: new InMemoryAnthropicKeyStore('stored-key') });
    expect((await testAiSettings(deps, admin, { provider: 'anthropic', model: 'claude-haiku-5-5' })).ok).toBe(true);
    expect(factory).toHaveBeenLastCalledWith('anthropic', 'claude-haiku-5-5', 'stored-key');
    await testAiSettings(deps, admin, { provider: 'anthropic', model: 'claude-haiku-4-5', anthropicApiKey: KEY });
    expect(factory).toHaveBeenLastCalledWith('anthropic', 'claude-haiku-4-5', KEY);
  });

  it('tests Bedrock without any key', async () => {
    const factory = vi.fn(() => stubProvider());
    const res = await testAiSettings(inMemoryAiSettingsDeps({ factory }), admin, { provider: 'bedrock', model: 'claude-haiku-4-5' });
    expect(res.ok).toBe(true);
    expect(factory).toHaveBeenCalledWith('bedrock', 'claude-haiku-4-5', null);
  });

  it.each([
    [401, 'AUTH'],
    [403, 'FORBIDDEN'],
    [404, 'MODEL_UNAVAILABLE'],
    [429, 'RATE_LIMITED'],
    [529, 'UNAVAILABLE'],
  ] as const)('maps a %i from the provider to %s with its message', async (status, code) => {
    const err = Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message: 'nope' } }, 'nope', new Headers());
    const deps = inMemoryAiSettingsDeps({ factory: () => stubProvider(err) });
    const res = await testAiSettings(deps, admin, { provider: 'bedrock', model: 'claude-haiku-5-5' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe(code);
    expect(res.detail).toContain('nope');
  });

  it('maps a non-HTTP failure (network, AWS credentials) to UNAVAILABLE', async () => {
    const deps = inMemoryAiSettingsDeps({ factory: () => stubProvider(new Error('socket hang up')) });
    const res = await testAiSettings(deps, admin, { provider: 'bedrock', model: 'claude-haiku-4-5' });
    expect(res).toMatchObject({ ok: false, error: 'UNAVAILABLE', detail: 'socket hang up' });
  });

  it('rejects a non-admin', async () => {
    await expect(testAiSettings(inMemoryAiSettingsDeps(), member, { provider: 'bedrock', model: 'claude-haiku-4-5' }))
      .rejects.toBeInstanceOf(ForbiddenError);
  });
});
