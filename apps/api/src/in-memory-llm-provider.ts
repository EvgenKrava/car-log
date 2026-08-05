import type { LlmProvider, ChatTurnResult } from '@carlog/domain';

// Deterministic fake for tests. Configure with the raw output to return, or an Error
// to throw (to exercise the 503 path). The text/context args are irrelevant to a
// fixed-output fake, so the methods ignore them (still satisfies LlmProvider).
// `chatRounds` scripts a tool loop: each chatTurn call shifts the next round off it.
export class InMemoryLlmProvider implements LlmProvider {
  constructor(
    private readonly output: unknown,
    private readonly throwErr?: Error,
    private readonly chatRounds: ChatTurnResult[] = [],
  ) {}
  async extractEvents(): Promise<unknown> {
    if (this.throwErr) throw this.throwErr;
    return this.output;
  }
  async extractEventsFromDocument(): Promise<unknown> {
    if (this.throwErr) throw this.throwErr;
    return this.output;
  }
  async chatTurn(): Promise<ChatTurnResult> {
    if (this.throwErr) throw this.throwErr;
    const next = this.chatRounds.shift();
    return next ?? { text: 'stub chat reply', toolCalls: [], raw: { type: 'stub' } };
  }
}
