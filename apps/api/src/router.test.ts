import { beforeEach, describe, expect, it, vi } from 'vitest';
import { route } from './router';
import { InMemoryCarRepository } from './in-memory-car-repository';
import { InMemoryEventRepository } from './in-memory-event-repository';
import { InMemoryProofRepository } from './in-memory-proof-repository';
import { InMemoryLlmProvider } from './in-memory-llm-provider';
import { InMemoryImportJobRepository } from './in-memory-import-job-repository';
import { InMemoryReminderRepository } from './in-memory-reminder-repository';
import { LlmUnavailableError } from './llm-errors';
import type { PhotoStorage } from '@carlog/domain';
import type { CognitoUserAdmin } from './cognito-user-admin';
import type { MetricsPort } from './cloudwatch-metrics';

let cars: InMemoryCarRepository;
const storage: PhotoStorage = {
  presignPut: async () => 'https://s3.example/put',
  presignGet: async () => 'https://s3.example/get',
  deleteObject: async () => {},
  exists: async () => true,
  copyObject: async () => {},
};
let enqueueSpy: ReturnType<typeof vi.fn>;
const adminUsers: CognitoUserAdmin = {
  listUsers: vi.fn(async () => ({ users: [] })),
  listGroupUsernames: vi.fn(async () => new Set<string>()),
  addToGroup: vi.fn(async () => {}),
  removeFromGroup: vi.fn(async () => {}),
  setEnabled: vi.fn(async () => {}),
  deleteUser: vi.fn(async () => {}),
  getSub: vi.fn(async () => null),
};
const metrics: MetricsPort = {
  apiTraffic: vi.fn(async () => []),
  errorTotals: vi.fn(async () => ({ count4xx: 0, count5xx: 0, p95LatencyMs: 0 })),
  estimatedCost: vi.fn(async () => ({ currency: 'USD', amount: 0, series: [] })),
};
let deps: { cars: InMemoryCarRepository; storage: PhotoStorage; events: InMemoryEventRepository; proofs: InMemoryProofRepository; reminders: InMemoryReminderRepository; llm: InMemoryLlmProvider; importJobs: InMemoryImportJobRepository; enqueueImport: ReturnType<typeof vi.fn>; loadScanBase64: (key: string) => Promise<string | null>; newId: () => string; adminUsers: CognitoUserAdmin; metrics: MetricsPort; apiId: string };
beforeEach(() => {
  cars = new InMemoryCarRepository();
  enqueueSpy = vi.fn().mockResolvedValue(undefined);
  deps = {
    cars, storage,
    events: new InMemoryEventRepository(),
    proofs: new InMemoryProofRepository(),
    reminders: new InMemoryReminderRepository(),
    llm: new InMemoryLlmProvider({ events: [{ date: '2024-01-15', mileage: 45000, cost: 1200, category: 'oil_change' }] }),
    importJobs: new InMemoryImportJobRepository(),
    enqueueImport: enqueueSpy,
    loadScanBase64: async () => 'BASE64DATA',
    newId: () => crypto.randomUUID(),
    adminUsers,
    metrics,
    apiId: 'api-1',
  };
});

const base = { groups: [] as string[], pathParams: {}, queryParams: {}, body: null };
const validBody = { make: 'Toyota', model: 'Corolla', year: 2020, mileage: 45000, fuelType: 'petrol' };

describe('route', () => {
  it('POST /cars creates a car scoped to the owner', async () => {
    const res = await route(deps, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: validBody });
    expect(res.statusCode).toBe(201);
    const car = JSON.parse(res.body);
    expect(car).toMatchObject({ make: 'Toyota', ownerId: 'u1' });
    expect(car.id).toBeDefined();
  });

  it('GET /cars lists only the owner cars', async () => {
    await route(deps, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: validBody });
    await route(deps, { ...base, method: 'POST', path: '/cars', ownerId: 'u2', body: validBody });
    const res = await route(deps, { ...base, method: 'GET', path: '/cars', ownerId: 'u1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveLength(1);
  });

  it('returns 400 on invalid body', async () => {
    const res = await route(deps, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: { make: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 when ownerId is missing', async () => {
    const res = await route(deps, { ...base, method: 'GET', path: '/cars', ownerId: null });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 deleting a missing car', async () => {
    const res = await route(deps, { ...base, method: 'DELETE', path: '/cars/nope', ownerId: 'u1', pathParams: { id: 'nope' } });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /cars/{id} clears an omitted optional field (full replace)', async () => {
    const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: { ...validBody, vin: '1HGCM82633A004352' } })).body);
    const res = await route(deps, { ...base, method: 'PUT', path: `/cars/${created.id}`, ownerId: 'u1', pathParams: { id: created.id }, body: validBody });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).vin).toBeUndefined();
  });

  async function makeCar(ownerId: string) {
    const res = await route(deps, { ...base, method: 'POST', path: '/cars', ownerId, body: validBody });
    return JSON.parse(res.body).id as string;
  }

  describe('sharing routes', () => {
    it('PUT /cars/{id}/sharing sets shared and returns the updated car', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, { ...base, method: 'PUT', path: `/cars/${carId}/sharing`, ownerId: 'u1', pathParams: { id: carId }, body: { shared: true } });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ id: carId, shared: true });
      expect(await cars.findSharedOwnerId(carId)).toBe('u1');
    });

    it('GET /public/cars/{carId} is reached without a token and does not 401', async () => {
      const carId = await makeCar('u1');
      await route(deps, { ...base, method: 'PUT', path: `/cars/${carId}/sharing`, ownerId: 'u1', pathParams: { id: carId }, body: { shared: true } });
      const res = await route(deps, { ...base, method: 'GET', path: `/public/cars/${carId}`, ownerId: null, pathParams: { carId } });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.id).toBe(carId);
      expect(body.ownerId).toBeUndefined();
    });

    it('GET /public/cars/{carId} 404s once unshared', async () => {
      const carId = await makeCar('u1');
      await route(deps, { ...base, method: 'PUT', path: `/cars/${carId}/sharing`, ownerId: 'u1', pathParams: { id: carId }, body: { shared: true } });
      await route(deps, { ...base, method: 'PUT', path: `/cars/${carId}/sharing`, ownerId: 'u1', pathParams: { id: carId }, body: { shared: false } });
      const res = await route(deps, { ...base, method: 'GET', path: `/public/cars/${carId}`, ownerId: null, pathParams: { carId } });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('event routes', () => {
    const ev = { date: '2026-07-14', mileage: 1000, cost: 500, category: 'oil_change', works: [{ description: 'Oil change', parts: [{ name: 'Filter', quantity: 1 }] }] };

    async function makeCar(ownerId: string) {
      const res = await route(deps, { ...base, method: 'POST', path: '/cars', ownerId, body: validBody });
      return JSON.parse(res.body).id as string;
    }

    it('creates and lists events for the owner car', async () => {
      const carId = await makeCar('u1');
      const created = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId }, body: ev });
      expect(created.statusCode).toBe(201);
      const list = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId } });
      expect(list.statusCode).toBe(200);
      const arr = JSON.parse(list.body);
      expect(arr).toHaveLength(1);
      expect(arr[0].works[0].parts[0].name).toBe('Filter');
    });

    it('event list excludes proof rows (collision guard)', async () => {
      const carId = await makeCar('u1');
      const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId }, body: ev })).body);
      // confirm a proof for the event
      await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events/${created.id}/proofs`, ownerId: 'u1', pathParams: { id: carId, eventId: created.id }, body: { proofId: '99999999-9999-9999-9999-999999999999', contentType: 'application/pdf', size: 1024 } });
      const list = JSON.parse((await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId } })).body);
      expect(list).toHaveLength(1); // only the event, not the proof
      expect(list[0].works).toBeDefined();
    });

    it('404s an event on a car the caller does not own', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/events`, ownerId: 'u2', pathParams: { id: carId } });
      expect(res.statusCode).toBe(404);
    });

    it('deleting an event cascade-deletes its proofs', async () => {
      const carId = await makeCar('u1');
      const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId }, body: ev })).body);
      await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events/${created.id}/proofs`, ownerId: 'u1', pathParams: { id: carId, eventId: created.id }, body: { proofId: '88888888-8888-8888-8888-888888888888', contentType: 'application/pdf', size: 1024 } });
      const del = await route(deps, { ...base, method: 'DELETE', path: `/cars/${carId}/events/${created.id}`, ownerId: 'u1', pathParams: { id: carId, eventId: created.id } });
      expect(del.statusCode).toBe(204);
      const proofs = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/events/${created.id}/proofs`, ownerId: 'u1', pathParams: { id: carId, eventId: created.id } });
      // event is gone -> requireEvent throws 404
      expect(proofs.statusCode).toBe(404);
    });

    it('from-scan proof with valid scans/ key creates proof and copies object', async () => {
      const carId = await makeCar('u1');
      const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId }, body: ev })).body);
      const copySpy = vi.fn().mockResolvedValue(undefined);
      deps.storage = { ...storage, copyObject: copySpy };
      const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events/${created.id}/proofs/from-scan`, ownerId: 'u1', pathParams: { id: carId, eventId: created.id }, body: { s3Key: 'scans/u1/test.jpg', contentType: 'image/jpeg', size: 5000 } });
      expect(res.statusCode).toBe(201);
      const proof = JSON.parse(res.body);
      expect(proof.id).toBeDefined();
      expect(proof.size).toBe(5000);
      expect(copySpy).toHaveBeenCalledWith('scans/u1/test.jpg', expect.stringContaining('proofs/'));
    });

    it('from-scan proof rejects foreign key prefix (IDOR guard)', async () => {
      const carId = await makeCar('u1');
      const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId }, body: ev })).body);
      const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events/${created.id}/proofs/from-scan`, ownerId: 'u1', pathParams: { id: carId, eventId: created.id }, body: { s3Key: 'photos/other/x.jpg', contentType: 'image/jpeg', size: 5000 } });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toBe('invalid s3Key');
    });
  });

  describe('POST /import/extract', () => {
    async function makeCar(ownerId: string): Promise<string> {
      const res = await route(deps, { ...base, method: 'POST', path: '/cars', ownerId, body: validBody });
      return JSON.parse(res.body).id as string;
    }

    it('returns extracted candidate events for the owner car', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, { ...base, method: 'POST', path: '/import/extract', ownerId: 'u1', body: { carId, text: 'oil change at 45000' } });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).events).toHaveLength(1);
    });

    it('404s when the car is not owned by the caller', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, { ...base, method: 'POST', path: '/import/extract', ownerId: 'u2', body: { carId, text: 'x' } });
      expect(res.statusCode).toBe(404);
    });

    it('400s on empty text', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, { ...base, method: 'POST', path: '/import/extract', ownerId: 'u1', body: { carId, text: '' } });
      expect(res.statusCode).toBe(400);
    });

    it('503s when the LLM provider is unavailable', async () => {
      const carId = await makeCar('u1');
      deps.llm = new InMemoryLlmProvider(null, new LlmUnavailableError());
      const res = await route(deps, { ...base, method: 'POST', path: '/import/extract', ownerId: 'u1', body: { carId, text: 'x' } });
      expect(res.statusCode).toBe(503);
    });

    it('422s when extraction yields shapeless output twice', async () => {
      const carId = await makeCar('u1');
      deps.llm = new InMemoryLlmProvider('not an array or events object');
      const res = await route(deps, { ...base, method: 'POST', path: '/import/extract', ownerId: 'u1', body: { carId, text: 'x' } });
      expect(res.statusCode).toBe(422);
    });
  });

  describe('import jobs', () => {
    async function makeCar(ownerId: string): Promise<string> {
      const res = await route(deps, { ...base, method: 'POST', path: '/cars', ownerId, body: validBody });
      return JSON.parse(res.body).id as string;
    }

    it('creates a job (202) and enqueues the worker payload', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, { ...base, method: 'POST', path: '/import/jobs', ownerId: 'u1', body: { carId, text: 'oil change 2024' } });
      expect(res.statusCode).toBe(202);
      const { jobId } = JSON.parse(res.body);
      expect(jobId).toBeDefined();
      expect(enqueueSpy).toHaveBeenCalledWith({ jobType: 'import', ownerId: 'u1', carId, jobId });
    });

    it('404s job creation for a foreign car', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, { ...base, method: 'POST', path: '/import/jobs', ownerId: 'u2', body: { carId, text: 'x' } });
      expect(res.statusCode).toBe(404);
      expect(enqueueSpy).not.toHaveBeenCalled();
    });

    it('400s when both text and s3Key are given', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, { ...base, method: 'POST', path: '/import/jobs', ownerId: 'u1', body: { carId, text: 'x', s3Key: 'k' } });
      expect(res.statusCode).toBe(400);
    });

    it('gets a job by id and hides server-side fields', async () => {
      const carId = await makeCar('u1');
      const created = await route(deps, { ...base, method: 'POST', path: '/import/jobs', ownerId: 'u1', body: { carId, text: 'oil change' } });
      const { jobId } = JSON.parse(created.body);
      const res = await route(deps, { ...base, method: 'GET', path: `/import/jobs/${jobId}`, ownerId: 'u1', pathParams: { jobId }, queryParams: { carId } });
      expect(res.statusCode).toBe(200);
      const job = JSON.parse(res.body);
      expect(job.status).toBe('pending');
      expect(job.text).toBeUndefined();
      expect(job.ownerId).toBeUndefined();
    });

    it('deletes a job (204) so it no longer surfaces as latest', async () => {
      const carId = await makeCar('u1');
      const created = await route(deps, { ...base, method: 'POST', path: '/import/jobs', ownerId: 'u1', body: { carId, text: 'oil change' } });
      const { jobId } = JSON.parse(created.body);
      const del = await route(deps, { ...base, method: 'DELETE', path: `/import/jobs/${jobId}`, ownerId: 'u1', pathParams: { jobId }, queryParams: { carId } });
      expect(del.statusCode).toBe(204);
      const latest = await route(deps, { ...base, method: 'GET', path: '/import/jobs', ownerId: 'u1', queryParams: { carId } });
      expect(latest.statusCode).toBe(404);
    });

    it('delete is idempotent (204 for a missing job)', async () => {
      const carId = await makeCar('u1');
      const del = await route(deps, { ...base, method: 'DELETE', path: '/import/jobs/nope', ownerId: 'u1', pathParams: { jobId: 'nope' }, queryParams: { carId } });
      expect(del.statusCode).toBe(204);
    });

    it('returns the latest job for a car and 404 when none', async () => {
      const carId = await makeCar('u1');
      const none = await route(deps, { ...base, method: 'GET', path: '/import/jobs', ownerId: 'u1', queryParams: { carId } });
      expect(none.statusCode).toBe(404);
      await route(deps, { ...base, method: 'POST', path: '/import/jobs', ownerId: 'u1', body: { carId, text: 'first' } });
      const res = await route(deps, { ...base, method: 'GET', path: '/import/jobs', ownerId: 'u1', queryParams: { carId } });
      expect(res.statusCode).toBe(200);
    });

    it('reports a stale running job as failed at read', async () => {
      const carId = await makeCar('u1');
      const old = new Date(Date.now() - 21 * 60 * 1000).toISOString();
      await deps.importJobs.create({
        id: crypto.randomUUID(), carId, ownerId: 'u1', status: 'running',
        progress: { done: 1, total: 3, found: 2 }, events: [], skippedChunks: 0, createdAt: old,
      });
      const res = await route(deps, { ...base, method: 'GET', path: '/import/jobs', ownerId: 'u1', queryParams: { carId } });
      const job = JSON.parse(res.body);
      expect(job.status).toBe('failed');
      expect(job.error).toBe('stale');
    });

    it('presigns a txt upload under the imports prefix', async () => {
      const res = await route(deps, { ...base, method: 'POST', path: '/import/presign', ownerId: 'u1', body: { size: 1000 } });
      expect(res.statusCode).toBe(200);
      const { key, uploadUrl } = JSON.parse(res.body);
      expect(key).toMatch(/^imports\/u1\/.+\.txt$/);
      expect(uploadUrl).toContain('https://');
    });

    it('rejects a create request with foreign s3Key prefix (IDOR guard)', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, { ...base, method: 'POST', path: '/import/jobs', ownerId: 'u1', body: { carId, s3Key: 'photos/other/x.txt' } });
      expect(res.statusCode).toBe(400);
      expect(enqueueSpy).not.toHaveBeenCalled();
    });

    it('accepts a create request with valid s3Key prefix', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, { ...base, method: 'POST', path: '/import/jobs', ownerId: 'u1', body: { carId, s3Key: 'imports/u1/x.txt' } });
      expect(res.statusCode).toBe(202);
      expect(enqueueSpy).toHaveBeenCalled();
    });
  });

  describe('scan routes', () => {
    async function makeCar(ownerId: string): Promise<string> {
      const res = await route(deps, { ...base, method: 'POST', path: '/cars', ownerId, body: validBody });
      return JSON.parse(res.body).id as string;
    }

    it('POST /import/scan/presign returns key and uploadUrl under scans/ prefix', async () => {
      const res = await route(deps, { ...base, method: 'POST', path: '/import/scan/presign', ownerId: 'u1', body: { contentType: 'application/pdf', size: 5000 } });
      expect(res.statusCode).toBe(200);
      const { key, uploadUrl } = JSON.parse(res.body);
      expect(key).toMatch(/^scans\/u1\/.+\.pdf$/);
      expect(uploadUrl).toContain('https://');
    });

    it('POST /import/scan returns extracted events for owned car', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, { ...base, method: 'POST', path: '/import/scan', ownerId: 'u1', body: { carId, s3Key: 'scans/u1/test.pdf', contentType: 'application/pdf' } });
      expect(res.statusCode).toBe(200);
      const { events } = JSON.parse(res.body);
      expect(events).toHaveLength(1);
      expect(events[0].category).toBe('oil_change');
    });

    it('POST /import/scan 404s for foreign carId', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, { ...base, method: 'POST', path: '/import/scan', ownerId: 'u2', body: { carId, s3Key: 'scans/u2/test.pdf', contentType: 'application/pdf' } });
      expect(res.statusCode).toBe(404);
    });

    it('POST /import/scan 400s for non-scans/ s3Key prefix (IDOR guard)', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, { ...base, method: 'POST', path: '/import/scan', ownerId: 'u1', body: { carId, s3Key: 'photos/other/x.pdf', contentType: 'application/pdf' } });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toBe('invalid s3Key');
    });

    it('POST /import/scan 422s when loadScanBase64 returns null', async () => {
      const carId = await makeCar('u1');
      deps.loadScanBase64 = async () => null;
      const res = await route(deps, { ...base, method: 'POST', path: '/import/scan', ownerId: 'u1', body: { carId, s3Key: 'scans/u1/missing.pdf', contentType: 'application/pdf' } });
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error).toBe('ExtractionFailed');
    });
  });

  describe('reminder routes', () => {
    const carBody = { make: 'Toyota', model: 'Corolla', year: 2020, mileage: 50000, fuelType: 'petrol' };
    const reminderBody = { title: 'Oil change', category: 'oil_change', dueDate: '2099-01-01', repeatMonths: 6 };

    async function makeCar(ownerId = 'u1'): Promise<string> {
      const res = await route(deps, { ...base, method: 'POST', path: '/cars', ownerId, body: carBody });
      return JSON.parse(res.body).id as string;
    }

    it('POST creates a reminder scoped to the owner and car', async () => {
      const carId = await makeCar();
      const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId }, body: reminderBody });
      expect(res.statusCode).toBe(201);
      expect(JSON.parse(res.body)).toMatchObject({ title: 'Oil change', carId, ownerId: 'u1' });
    });

    it('GET lists only that car reminders', async () => {
      const carId = await makeCar();
      await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId }, body: reminderBody });
      const res = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId } });
      expect(JSON.parse(res.body)).toHaveLength(1);
    });

    it('404s for another owner', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/reminders`, ownerId: 'u2', pathParams: { id: carId } });
      expect(res.statusCode).toBe(404);
    });

    it('400s when neither dueDate nor dueMileage is set', async () => {
      const carId = await makeCar();
      const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId }, body: { title: 'x', category: 'other' } });
      expect(res.statusCode).toBe(400);
    });

    it('409s at the 20-reminder cap', async () => {
      const carId = await makeCar();
      for (let i = 0; i < 20; i++) {
        await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId }, body: reminderBody });
      }
      const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId }, body: reminderBody });
      expect(res.statusCode).toBe(409);
    });

    it('PUT updates and DELETE removes', async () => {
      const carId = await makeCar();
      const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId }, body: reminderBody })).body);
      const put = await route(deps, { ...base, method: 'PUT', path: `/cars/${carId}/reminders/${created.id}`, ownerId: 'u1', pathParams: { id: carId, reminderId: created.id }, body: { ...reminderBody, title: 'Renamed' } });
      expect(JSON.parse(put.body).title).toBe('Renamed');
      const del = await route(deps, { ...base, method: 'DELETE', path: `/cars/${carId}/reminders/${created.id}`, ownerId: 'u1', pathParams: { id: carId, reminderId: created.id } });
      expect(del.statusCode).toBe(204);
      const list = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId } });
      expect(JSON.parse(list.body)).toHaveLength(0);
    });

    it('complete on a repeating reminder returns the next occurrence and bumps car mileage', async () => {
      const carId = await makeCar();
      const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId }, body: reminderBody })).body);
      const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders/${created.id}/complete`, ownerId: 'u1', pathParams: { id: carId, reminderId: created.id }, body: { date: '2026-07-16', mileage: 60000 } });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ id: created.id, dueDate: '2027-01-16' });
      const car = JSON.parse((await route(deps, { ...base, method: 'GET', path: `/cars/${carId}`, ownerId: 'u1', pathParams: { id: carId } })).body);
      expect(car.mileage).toBe(60000);
    });

    it('complete on a one-shot reminder deletes it and returns 204', async () => {
      const carId = await makeCar();
      const oneShot = { title: 'Inspection', category: 'inspection', dueDate: '2099-01-01' };
      const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId }, body: oneShot })).body);
      const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders/${created.id}/complete`, ownerId: 'u1', pathParams: { id: carId, reminderId: created.id }, body: { date: '2026-07-16', mileage: 0 } });
      expect(res.statusCode).toBe(204);
      const list = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/reminders`, ownerId: 'u1', pathParams: { id: carId } });
      expect(JSON.parse(list.body)).toHaveLength(0);
    });

    it('complete 404s on a missing reminder', async () => {
      const carId = await makeCar();
      const res = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/reminders/00000000-0000-4000-8000-000000000000/complete`, ownerId: 'u1', pathParams: { id: carId, reminderId: '00000000-0000-4000-8000-000000000000' }, body: { date: '2026-07-16', mileage: 0 } });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('car mileage auto-bump from events', () => {
    const carBody = { make: 'Toyota', model: 'Corolla', year: 2020, mileage: 50000, fuelType: 'petrol' };
    const eventBody = { date: '2026-07-01', mileage: 55000, cost: 100, category: 'oil_change' };

    it('POST event with higher mileage bumps the car', async () => {
      const carId = JSON.parse((await route(deps, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: carBody })).body).id;
      await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId }, body: eventBody });
      const car = JSON.parse((await route(deps, { ...base, method: 'GET', path: `/cars/${carId}`, ownerId: 'u1', pathParams: { id: carId } })).body);
      expect(car.mileage).toBe(55000);
    });

    it('POST event with lower mileage (backdated) leaves the car unchanged', async () => {
      const carId = JSON.parse((await route(deps, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: carBody })).body).id;
      await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId }, body: { ...eventBody, mileage: 30000 } });
      const car = JSON.parse((await route(deps, { ...base, method: 'GET', path: `/cars/${carId}`, ownerId: 'u1', pathParams: { id: carId } })).body);
      expect(car.mileage).toBe(50000);
    });

    it('PUT event with higher mileage bumps the car', async () => {
      const carId = JSON.parse((await route(deps, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: carBody })).body).id;
      const ev = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId }, body: eventBody })).body);
      await route(deps, { ...base, method: 'PUT', path: `/cars/${carId}/events/${ev.id}`, ownerId: 'u1', pathParams: { id: carId, eventId: ev.id }, body: { ...eventBody, mileage: 60000 } });
      const car = JSON.parse((await route(deps, { ...base, method: 'GET', path: `/cars/${carId}`, ownerId: 'u1', pathParams: { id: carId } })).body);
      expect(car.mileage).toBe(60000);
    });
  });

  describe('chat routes', () => {
    it('POST /cars/{id}/chat returns a reply for the owner', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, {
        ...base, method: 'POST', path: `/cars/${carId}/chat`, ownerId: 'u1', pathParams: { id: carId },
        body: { messages: [{ role: 'user', content: 'When is my next service?' }] },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).reply).toBe('stub chat reply');
    });

    it('404s for a car the caller does not own', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, {
        ...base, method: 'POST', path: `/cars/${carId}/chat`, ownerId: 'u2', pathParams: { id: carId },
        body: { messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(res.statusCode).toBe(404);
    });

    it('400s when the last message is not from the user', async () => {
      const carId = await makeCar('u1');
      const res = await route(deps, {
        ...base, method: 'POST', path: `/cars/${carId}/chat`, ownerId: 'u1', pathParams: { id: carId },
        body: { messages: [{ role: 'assistant', content: 'hello' }] },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
