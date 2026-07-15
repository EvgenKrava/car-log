import type { ImportJobRecord, ImportJobRepository } from './import-job-repository';
import { importJobSk } from './import-job-repository';

// Single map keyed by PK|SK so key collisions surface in tests (repo convention).
export class InMemoryImportJobRepository implements ImportJobRepository {
  private rows = new Map<string, ImportJobRecord>();
  private key(ownerId: string, carId: string, jobId: string): string {
    return `USER#${ownerId}|${importJobSk(carId, jobId)}`;
  }
  async create(job: ImportJobRecord): Promise<void> {
    this.rows.set(this.key(job.ownerId, job.carId, job.id), structuredClone(job));
  }
  async get(ownerId: string, carId: string, jobId: string): Promise<ImportJobRecord | null> {
    return structuredClone(this.rows.get(this.key(ownerId, carId, jobId)) ?? null);
  }
  async latestForCar(ownerId: string, carId: string): Promise<ImportJobRecord | null> {
    const prefix = `USER#${ownerId}|CAR#${carId}#IMPORT#`;
    const jobs = [...this.rows.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
    if (jobs.length === 0) return null;
    jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return structuredClone(jobs[0] ?? null);
  }
  async update(job: ImportJobRecord): Promise<void> {
    this.rows.set(this.key(job.ownerId, job.carId, job.id), structuredClone(job));
  }
  async remove(ownerId: string, carId: string, jobId: string): Promise<void> {
    this.rows.delete(this.key(ownerId, carId, jobId));
  }
}