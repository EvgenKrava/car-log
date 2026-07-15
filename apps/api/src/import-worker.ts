import {
  chunkText, extractEvents, type CarRepository, type LlmProvider,
} from '@carlog/domain';
import { IMPORT_CHUNK_SIZE, MAX_JOB_EVENTS } from '@carlog/contracts';
import type { ImportJobRepository } from './import-job-repository';

export type ImportWorkerDeps = {
  jobs: ImportJobRepository;
  cars: CarRepository;
  llm: LlmProvider;
  loadS3Text: (key: string) => Promise<string | null>;
  remainingMs: () => number;
};

export type ImportWorkPayload = { jobType: 'import'; ownerId: string; carId: string; jobId: string };

const MIN_BUDGET_MS = 60_000;

// Detached-invocation entry point: loads the job's text, chunks it, and runs each chunk
// through the existing extractEvents use-case, persisting progress after every chunk so
// the polling GET sees live numbers. Per-chunk failures are skipped; the job only fails
// outright when nothing could be extracted, the file is missing, or time runs out.
export async function runImportJob(deps: ImportWorkerDeps, payload: ImportWorkPayload): Promise<void> {
  const job = await deps.jobs.get(payload.ownerId, payload.carId, payload.jobId);
  if (!job) return; // row expired or bogus payload — nothing to do

  const fail = async (error: string): Promise<void> => {
    await deps.jobs.update({ ...job, status: 'failed', error });
  };

  const car = await deps.cars.getById(payload.ownerId, payload.carId);
  if (!car) return fail('carMissing');

  let text: string | null = job.text ?? null;
  if (!text && job.s3Key) {
    if (!job.s3Key.startsWith(`imports/${payload.ownerId}/`)) {
      return fail('fileMissing');
    }
    text = await deps.loadS3Text(job.s3Key);
  }
  if (!text || text.trim().length === 0) return fail('fileMissing');

  const chunks = chunkText(text, IMPORT_CHUNK_SIZE);
  if (chunks.length === 0) return fail('fileMissing');

  job.status = 'running';
  job.progress = { done: 0, total: chunks.length, found: 0 };
  await deps.jobs.update(job);

  const ctx = { car: { make: car.make, model: car.model, year: car.year } };
  for (const chunk of chunks) {
    if (deps.remainingMs() < MIN_BUDGET_MS) {
      return fail('timeBudgetExceeded'); // partial events/progress already persisted on `job`
    }
    try {
      const found = await extractEvents(chunk, deps.llm, ctx);
      const room = MAX_JOB_EVENTS - job.events.length;
      job.events.push(...found.slice(0, Math.max(0, room)));
      job.progress.found = job.events.length;
    } catch {
      job.skippedChunks += 1; // ExtractionFailed or LlmUnavailable — skip this chunk
    }
    job.progress.done += 1;
    await deps.jobs.update(job);
  }

  if (job.events.length === 0 && job.skippedChunks === job.progress.total) {
    return fail('extractionFailed');
  }
  job.status = 'completed';
  await deps.jobs.update(job);
}
