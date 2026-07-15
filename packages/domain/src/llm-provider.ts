export type ExtractionContext = {
  car: { make: string; model: string; year?: number };
  // Recent known (date, mileage) points from the car's existing timeline, newest first.
  // Used to estimate an event's date from a stated odometer reading when the document
  // gives no date. Empty/undefined when the car has no usable history.
  history?: { date: string; mileage: number }[];
};

export interface LlmProvider {
  // Returns the model's raw structured output as unknown JSON. The extractEvents
  // use-case validates it against the contract schema — the provider is NOT
  // responsible for schema conformance.
  extractEvents(text: string, ctx: ExtractionContext): Promise<unknown>;
  // Vision: read a maintenance document (image or PDF) and return raw structured output.
  extractEventsFromDocument(base64: string, mediaType: string, ctx: ExtractionContext): Promise<unknown>;
}
