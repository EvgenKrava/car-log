export type ExtractionContext = {
  car: { make: string; model: string; year?: number };
};

export interface LlmProvider {
  // Returns the model's raw structured output as unknown JSON. The extractEvents
  // use-case validates it against the contract schema — the provider is NOT
  // responsible for schema conformance.
  extractEvents(text: string, ctx: ExtractionContext): Promise<unknown>;
}
