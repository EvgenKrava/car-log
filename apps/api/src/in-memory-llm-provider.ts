import type { LlmProvider, ExtractionContext } from '@carlog/domain';

// Deterministic fake for tests. Configure with the raw output to return, or an Error
// to throw (to exercise the 503 path).
export class InMemoryLlmProvider implements LlmProvider {
  constructor(private readonly output: unknown, private readonly throwErr?: Error) {}
  async extractEvents(_text: string, _ctx: ExtractionContext): Promise<unknown> {
    if (this.throwErr) throw this.throwErr;
    return this.output;
  }
}
