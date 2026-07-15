import {
  CreateImportJobRequestSchema, ImportTxtPresignRequestSchema, type ImportJob,
} from '@carlog/contracts';
import { CarNotFoundError, type CarRepository, type PhotoStorage } from '@carlog/domain';
import { ok, type ApiResult } from './errors';
import type { ImportJobRecord, ImportJobRepository } from './import-job-repository';
import type { ImportWorkPayload } from './import-worker';
import type { ApiEvent } from './router';

export type ImportJobDeps = {
  cars: CarRepository;
  jobs: ImportJobRepository;
  storage: PhotoStorage;
  enqueueImport: (payload: ImportWorkPayload) => Promise<void>;
  newId: () => string;
};

const STALE_MS = 20 * 60 * 1000;

// The API returns the ImportJob shape only — the stored record's ownerId/text/s3Key stay server-side.
function toApiJob(rec: ImportJobRecord): ImportJob {
  const { ownerId, text, s3Key, ...job } = rec;
  if ((job.status === 'pending' || job.status === 'running') && Date.now() - Date.parse(job.createdAt) > STALE_MS) {
    return { ...job, status: 'failed', error: 'stale' };
  }
  return job;
}

// Handles /import/presign, /import/jobs, /import/jobs/{jobId}; returns null if not matched.
export async function handleImportJobRoute(
  deps: ImportJobDeps, event: ApiEvent, ownerId: string,
): Promise<ApiResult | null> {
  const { method, path, pathParams, body, queryParams } = event;

  if (path === '/import/presign' && method === 'POST') {
    ImportTxtPresignRequestSchema.parse(body);
    const key = `imports/${ownerId}/${deps.newId()}.txt`;
    const uploadUrl = await deps.storage.presignPut(key, 'text/plain', 0);
    return ok(200, { key, uploadUrl });
  }

  if (path === '/import/jobs' && method === 'POST') {
    const req = CreateImportJobRequestSchema.parse(body);
    const car = await deps.cars.getById(ownerId, req.carId);
    if (!car) throw new CarNotFoundError(req.carId);
    if (req.s3Key && !req.s3Key.startsWith(`imports/${ownerId}/`)) {
      return ok(400, { error: 'ValidationError', message: 'invalid s3Key' });
    }
    const job: ImportJobRecord = {
      id: deps.newId(), carId: req.carId, ownerId,
      status: 'pending', progress: { done: 0, total: 0, found: 0 },
      events: [], skippedChunks: 0, createdAt: new Date().toISOString(),
      ...(req.text ? { text: req.text } : {}), ...(req.s3Key ? { s3Key: req.s3Key } : {}),
    };
    await deps.jobs.create(job);
    await deps.enqueueImport({ jobType: 'import', ownerId, carId: req.carId, jobId: job.id });
    return ok(202, { jobId: job.id });
  }

  if (path === '/import/jobs' && method === 'GET') {
    const carId = queryParams.carId;
    if (!carId) return ok(400, { error: 'ValidationError', message: 'carId query param required' });
    const latest = await deps.jobs.latestForCar(ownerId, carId);
    if (!latest) return ok(404, { error: 'NotFound', message: 'No import job for car' });
    return ok(200, toApiJob(latest));
  }

  const jobId = pathParams.jobId;
  if (jobId && path === `/import/jobs/${jobId}` && method === 'GET') {
    const carId = queryParams.carId;
    if (!carId) return ok(400, { error: 'ValidationError', message: 'carId query param required' });
    const job = await deps.jobs.get(ownerId, carId, jobId);
    if (!job) return ok(404, { error: 'NotFound', message: 'Import job not found' });
    return ok(200, toApiJob(job));
  }

  return null;
}