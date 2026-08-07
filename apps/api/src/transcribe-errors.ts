export class TranscribeUnavailableError extends Error {
  constructor(message = 'Transcription is temporarily unavailable') {
    super(message);
    this.name = 'TranscribeUnavailableError';
  }
}
