// Thrown by the Bedrock adapter when the model backend is unreachable / throttled /
// returns a 5xx. Distinct from the domain's ExtractionFailedError (bad model OUTPUT).
export class LlmUnavailableError extends Error {
  constructor(message = 'The AI service is temporarily unavailable') {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}
