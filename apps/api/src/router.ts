import { CreateCarSchema } from '@carlog/contracts';
import { CarNotFoundError, createCar, type CarRepository, type PhotoRepository, type PhotoStorage, type EventRepository, type ProofRepository, type LlmProvider, type ReminderRepository } from '@carlog/domain';
import { ok, withErrorHandling, type ApiResult } from './errors';
import { handlePhotoRoute } from './photo-routes';
import { handleEventRoute } from './event-routes';
import { handleReminderRoute } from './reminder-routes';
import { handleImportRoute } from './llm-routes';
import { handleImportJobRoute } from './import-job-routes';
import { handleScanRoute } from './scan-routes';
import type { ImportJobRepository } from './import-job-repository';
import type { ImportWorkPayload } from './import-worker';

export type ApiEvent = {
  method: string;
  path: string;
  ownerId: string | null;
  pathParams: Record<string, string>;
  queryParams: Record<string, string>;
  body: unknown;
};

export type RouteDeps = {
  cars: CarRepository; photos: PhotoRepository; storage: PhotoStorage;
  events: EventRepository; proofs: ProofRepository; reminders: ReminderRepository; llm: LlmProvider;
  importJobs: ImportJobRepository;
  enqueueImport: (p: ImportWorkPayload) => Promise<void>;
  loadScanBase64: (key: string) => Promise<string | null>;
  newId: () => string;
};

export function route(deps: RouteDeps, event: ApiEvent): Promise<ApiResult> {
  return withErrorHandling(async () => {
    const { method, path, ownerId, pathParams, body } = event;
    if (!ownerId) return ok(401, { error: 'Unauthorized' });
    const id = pathParams.id;

    if (path === '/import/extract') {
      const result = await handleImportRoute(deps, event, ownerId);
      if (result) return result;
    }

    if (path.startsWith('/import/scan')) {
      const result = await handleScanRoute(
        { cars: deps.cars, events: deps.events, storage: deps.storage, llm: deps.llm, loadScanBase64: deps.loadScanBase64, newId: deps.newId },
        event, ownerId,
      );
      if (result) return result;
    }

    if (path.startsWith('/import/')) {
      const result = await handleImportJobRoute(
        { cars: deps.cars, jobs: deps.importJobs, storage: deps.storage, enqueueImport: deps.enqueueImport, newId: deps.newId },
        event, ownerId,
      );
      if (result) return result;
    }

    // Photo sub-routes: /cars/{id}/photos*
    if (id && path.startsWith(`/cars/${id}/photos`)) {
      const result = await handlePhotoRoute(deps, event, ownerId, id);
      if (result) return result;
    }

    if (id && path.startsWith(`/cars/${id}/events`)) {
      const result = await handleEventRoute(deps, event, ownerId, id);
      if (result) return result;
    }

    if (id && path.startsWith(`/cars/${id}/reminders`)) {
      const result = await handleReminderRoute({ cars: deps.cars, reminders: deps.reminders }, event, ownerId, id);
      if (result) return result;
    }

    if (path === '/cars' && method === 'GET') return ok(200, await deps.cars.listByOwner(ownerId));
    if (path === '/cars' && method === 'POST') {
      const car = createCar(ownerId, CreateCarSchema.parse(body));
      return ok(201, await deps.cars.create(car));
    }
    if (id && path === `/cars/${id}` && method === 'PUT') return ok(200, await deps.cars.update(ownerId, id, CreateCarSchema.parse(body)));
    if (id && path === `/cars/${id}` && method === 'DELETE') { await deps.cars.delete(ownerId, id); return ok(204, null); }
    if (id && path === `/cars/${id}` && method === 'GET') {
      const car = await deps.cars.getById(ownerId, id);
      if (!car) throw new CarNotFoundError(id);
      return ok(200, car);
    }
    return ok(404, { error: 'NoRoute' });
  });
}
