import type {
  LlmProvider, ExtractionContext, CarChatContext, ChatAttachment, ChatTurnEntry,
  ChatTurnResult, ChatToolDefinition, ChatToolChoice,
} from '@carlog/domain';
import type { AiSettingsStore } from './ai-settings-store';
import type { AnthropicKeyStore } from './anthropic-key-store';
import type { ProviderFactory } from './llm-factory';
import { LlmUnavailableError } from './llm-errors';

// How long a warm Lambda keeps using the provider it built before re-reading the saved
// settings. An admin's change applies at once in the instance that saved it and within
// this window everywhere else; each refresh costs one DynamoDB read (plus one SSM read
// when the Claude API is selected).
export const SETTINGS_TTL_MS = 60_000;

export type LlmResolverDeps = {
  settings: AiSettingsStore;
  keys: AnthropicKeyStore;
  factory: ProviderFactory;
  ttlMs?: number;
  now?: () => number;
};

type Cached = { signature: string; provider: LlmProvider; loadedAt: number };

// Builds the LLM provider the admin selected, and caches it.
export class LlmResolver {
  private cached: Cached | null = null;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: LlmResolverDeps) {
    this.ttlMs = deps.ttlMs ?? SETTINGS_TTL_MS;
    this.now = deps.now ?? Date.now;
  }

  // Marks the cached provider stale so the next call re-reads the settings. It stays
  // available as the fallback if that read fails.
  invalidate(): void {
    if (this.cached) this.cached.loadedAt = Number.NEGATIVE_INFINITY;
  }

  async current(): Promise<LlmProvider> {
    const cached = this.cached;
    if (cached && this.now() - cached.loadedAt < this.ttlMs) return cached.provider;
    try {
      const settings = await this.deps.settings.get();
      const key = settings.provider === 'anthropic' ? await this.deps.keys.get() : null;
      const signature = `${settings.provider}|${settings.model}|${key ?? ''}`;
      // Unchanged settings keep the same client, and with it its open connections.
      const provider = cached?.signature === signature
        ? cached.provider
        : this.deps.factory(settings.provider, settings.model, key);
      this.cached = { signature, provider, loadedAt: this.now() };
      return provider;
    } catch (err) {
      const e = err as Error;
      if (cached) {
        // A failed refresh (DynamoDB/SSM hiccup, key missing) keeps serving the last good
        // provider rather than taking AI features down; retry after another TTL.
        console.error('AI settings refresh failed; keeping the previous provider', e.name, e.message);
        cached.loadedAt = this.now();
        return cached.provider;
      }
      console.error('AI settings could not be loaded', e.name, e.message);
      throw new LlmUnavailableError();
    }
  }
}

// The LlmProvider the rest of the API depends on: each call goes to whichever provider
// the admin selected, so switching needs no redeploy.
export class SwitchableLlmProvider implements LlmProvider {
  constructor(private readonly resolver: { current(): Promise<LlmProvider> }) {}

  async extractEvents(text: string, ctx: ExtractionContext): Promise<unknown> {
    return (await this.resolver.current()).extractEvents(text, ctx);
  }

  async extractEventsFromDocument(base64: string, mediaType: string, ctx: ExtractionContext): Promise<unknown> {
    return (await this.resolver.current()).extractEventsFromDocument(base64, mediaType, ctx);
  }

  async chatTurn(
    transcript: ChatTurnEntry[],
    context: CarChatContext,
    attachments: ChatAttachment[],
    tools: ChatToolDefinition[],
    toolChoice: ChatToolChoice,
  ): Promise<ChatTurnResult> {
    return (await this.resolver.current()).chatTurn(transcript, context, attachments, tools, toolChoice);
  }
}
