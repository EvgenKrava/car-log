import { ScanPresignRequestSchema, ExtractFromScanRequestSchema } from '@carlog/contracts';
import { CarNotFoundError, extractEventsFromDocument, type CarRepository, type EventRepository, type PhotoStorage, type LlmProvider } from '@carlog/domain';
import { ok, type ApiResult } from './errors';
import { buildExtractionContext } from './extraction-context';
import type { ApiEvent } from './router';

export type ScanDeps = {
  cars: CarRepository;
  events: EventRepository;
  storage: PhotoStorage;
  llm: LlmProvider;
  loadScanBase64: (key: string) => Promise<string | null>;
  newId: () => string;
};

export async function handleScanRoute(deps: ScanDeps, event: ApiEvent, ownerId: string): Promise<ApiResult | null> {
  const { method, path, body } = event;

  if (path === '/import/scan/presign' && method === 'POST') {
    const req = ScanPresignRequestSchema.parse(body);
    const ext = req.contentType === 'application/pdf' ? 'pdf' : req.contentType.split('/')[1];
    const key = `scans/${ownerId}/${deps.newId()}.${ext}`;
    const uploadUrl = await deps.storage.presignPut(key, req.contentType, 0);
    return ok(200, { key, uploadUrl });
  }

  if (path === '/import/scan' && method === 'POST') {
    const req = ExtractFromScanRequestSchema.parse(body);
    const car = await deps.cars.getById(ownerId, req.carId);
    if (!car) throw new CarNotFoundError(req.carId);
    if (!req.s3Key.startsWith(`scans/${ownerId}/`)) return ok(400, { error: 'ValidationError', message: 'invalid s3Key' });
    const base64 = await deps.loadScanBase64(req.s3Key);
    if (!base64) return ok(422, { error: 'ExtractionFailed', message: 'Could not read the document' });
    const ctx = await buildExtractionContext(deps.events, ownerId, car);
    const events = await extractEventsFromDocument(base64, req.contentType, deps.llm, ctx);
    return ok(200, { events });
  }

  return null;
}
