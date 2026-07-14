import type { LlmProvider } from '@carlog/domain';

// Deterministic fake for tests. Configure with the raw output to return, or an Error
// to throw (to exercise the 503 path). The text/context args are irrelevant to a
// fixed-output fake, so the method ignores them (still satisfies LlmProvider).
export class InMemoryLlmProvider implements LlmProvider {
  constructor(private readonly output: unknown, private readonly throwErr?: Error) {}
  async extractEvents(): Promise<unknown> {
    if (this.throwErr) throw this.throwErr;
    return this.output;
  }
}
