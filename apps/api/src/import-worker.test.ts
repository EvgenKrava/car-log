import { beforeEach, describe, expect, it } from 'vitest';
import { runImportJob, type ImportWorkerDeps } from './import-worker';
import { InMemoryImportJobRepository } from './in-memory-import-job-repository';
import { InMemoryCarRepository } from './in-memory-car-repository';
import { InMemoryLlmProvider } from './in-memory-llm-provider';
import type { ImportJobRecord } from './import-job-repository';

const OWNER = 'u1';
const valid = { date: '2024-01-15', mileage: 45000, cost: 1200, category: 'oil_change' };

function makeJob(overrides: Partial<ImportJobRecord>): ImportJobRecord {
  return {
    id: '3f1e9d5a-6b2c-4e8f-9a1b-2c3d4e5f6a7b',
    carId: '',
    ownerId: OWNER,
    status: 'pending',
    progress: { done: 0, total: 0, found: 0 },
    events: [], skippedChunks: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('runImportJob', () => {
  let jobs: InMemoryImportJobRepository;
  let cars: InMemoryCarRepository;
  let carId: string;

  beforeEach(async () => {
    jobs = new InMemoryImportJobRepository();
    cars = new InMemoryCarRepository();
    const car = await cars.create({
      id: '9f1e9d5a-6b2c-4e8f-9a1b-2c3d4e5f6a7b', ownerId: OWNER,
      make: 'Toyota', model: 'Corolla', year: 2020, mileage: 45000, fuelType: 'petrol',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    carId = car.id;
  });

  const deps = (llmOutput: unknown, extra?: Partial<ImportWorkerDeps>): ImportWorkerDeps => ({
    jobs, cars,
    llm: new InMemoryLlmProvider(llmOutput),
    loadS3Text: async () => null,
    remainingMs: () => 300_000,
    ...extra,
  });

  it('processes inline text to completed with events and progress', async () => {
    const job = makeJob({ carId, text: 'oil change jan 2024' });
    await jobs.create(job);
    await runImportJob(deps({ events: [valid] }), { jobType: 'import', ownerId: OWNER, carId, jobId: job.id });
    const done = await jobs.get(OWNER, carId, job.id);
    expect(done?.status).toBe('completed');
    expect(done?.events).toHaveLength(1);
    expect(done?.progress).toMatchObject({ done: 1, total: 1, found: 1 });
  });

  it('splits long text into multiple chunks and merges results', async () => {
    const line = 'oil change at 45000 km, 1200 UAH'.padEnd(200, '.');
    const text = Array.from({ length: 120 }, () => line).join('\n'); // ~24k chars → 3 chunks
    const job = makeJob({ carId, text });
    await jobs.create(job);
    await runImportJob(deps({ events: [valid] }), { jobType: 'import', ownerId: OWNER, carId, jobId: job.id });
    const done = await jobs.get(OWNER, carId, job.id);
    expect(done?.status).toBe('completed');
    expect(done?.progress.total).toBeGreaterThan(1);
    expect(done?.events.length).toBe(done?.progress.total); // one event per chunk from the fake
  });

  it('skips a failing chunk and completes with skippedChunks accounted', async () => {
    // extractEvents retries once on shapeless output, so to fail a chunk we need TWO
    // consecutive shapeless returns. We alternate per extraction attempt: chunk 1 succeeds
    // on first try, chunk 2 fails twice (shapeless + shapeless retry) → skipped.
    let call = 0;
    const alternating = {
      extractEvents: async () => {
        const result = call++ % 3 === 0 ? { events: [valid] } : 'garbage';
        return result;
      },
      extractEventsFromDocument: async () => ({ events: [] }),
    };
    const line = 'x'.padEnd(9000, 'y');
    const text = `${line}\n${line}`; // 2 chunks
    const job = makeJob({ carId, text });
    await jobs.create(job);
    await runImportJob(deps(null, { llm: alternating }), { jobType: 'import', ownerId: OWNER, carId, jobId: job.id });
    const done = await jobs.get(OWNER, carId, job.id);
    expect(done?.status).toBe('completed');
    expect(done?.skippedChunks).toBe(1);
    expect(done?.events).toHaveLength(1);
  });

  it('fails the job when ALL chunks fail', async () => {
    const job = makeJob({ carId, text: 'some text' });
    await jobs.create(job);
    await runImportJob(deps('never valid'), { jobType: 'import', ownerId: OWNER, carId, jobId: job.id });
    const done = await jobs.get(OWNER, carId, job.id);
    expect(done?.status).toBe('failed');
    expect(done?.error).toBe('extractionFailed');
  });

  it('fails with fileMissing when the S3 object is gone', async () => {
    const job = makeJob({ carId, s3Key: 'imports/u1/gone.txt' });
    await jobs.create(job);
    await runImportJob(deps({ events: [valid] }), { jobType: 'import', ownerId: OWNER, carId, jobId: job.id });
    const done = await jobs.get(OWNER, carId, job.id);
    expect(done?.status).toBe('failed');
    expect(done?.error).toBe('fileMissing');
  });

  it('stops early with timeBudgetExceeded, keeping partial results', async () => {
    const line = 'x'.padEnd(9000, 'y');
    const text = `${line}\n${line}\n${line}`; // 3 chunks
    const job = makeJob({ carId, text });
    await jobs.create(job);
    let calls = 0;
    const budget = () => (calls === 0 ? 300_000 : 30_000); // after first chunk, <60s left
    const counting = {
      extractEvents: async () => { calls++; return { events: [valid] }; },
      extractEventsFromDocument: async () => ({ events: [] }),
    };
    await runImportJob(deps(null, { llm: counting, remainingMs: budget }), { jobType: 'import', ownerId: OWNER, carId, jobId: job.id });
    const done = await jobs.get(OWNER, carId, job.id);
    expect(done?.status).toBe('failed');
    expect(done?.error).toBe('timeBudgetExceeded');
    expect(done?.events.length).toBeGreaterThan(0);
  });

  it('does nothing when the job row is missing', async () => {
    await expect(
      runImportJob(deps({ events: [valid] }), { jobType: 'import', ownerId: OWNER, carId, jobId: 'missing' }),
    ).resolves.toBeUndefined();
  });

  it('fails with fileMissing when s3Key points outside owner prefix (IDOR guard)', async () => {
    const job = makeJob({ carId, s3Key: 'imports/OTHER/x.txt' });
    await jobs.create(job);
    const loadSpy = async (): Promise<string | null> => {
      throw new Error('loadS3Text should not be called for foreign key');
    };
    await runImportJob(deps({ events: [valid] }, { loadS3Text: loadSpy }), { jobType: 'import', ownerId: OWNER, carId, jobId: job.id });
    const done = await jobs.get(OWNER, carId, job.id);
    expect(done?.status).toBe('failed');
    expect(done?.error).toBe('fileMissing');
  });
});