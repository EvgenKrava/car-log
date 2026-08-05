import { CreateCarSchema, SetSharingSchema } from '@carlog/contracts';
import { CarNotFoundError, createCar, type CarRepository, type PhotoStorage, type EventRepository, type ProofRepository, type LlmProvider, type ReminderRepository, type ChatSessionRepository } from '@carlog/domain';
import { ok, withErrorHandling, type ApiResult } from './errors';
import { handleEventRoute } from './event-routes';
import { handleReminderRoute } from './reminder-routes';
import { handleChatRoute } from './chat-session-routes';
import { handleImportRoute } from './llm-routes';
import { handleImportJobRoute } from './import-job-routes';
import { handleScanRoute } from './scan-routes';
import { handleAdminRoute } from './admin-routes';
import { handlePublicRoute } from './public-routes';
import type { ImportJobRepository } from './import-job-repository';
import type { ImportWorkPayload } from './import-worker';
import type { CognitoUserAdmin } from './cognito-user-admin';
import type { MetricsPort } from './cloudwatch-metrics';

export type ApiEvent = {
  method: string;
  path: string;
  ownerId: string | null;
  groups: string[];
  pathParams: Record<string, string>;
  queryParams: Record<string, string>;
  body: unknown;
};

export type RouteDeps = {
  cars: CarRepository; storage: PhotoStorage;
  events: EventRepository; proofs: ProofRepository; reminders: ReminderRepository; llm: LlmProvider;
  sessions: ChatSessionRepository;
  importJobs: ImportJobRepository;
  enqueueImport: (p: ImportWorkPayload) => Promise<void>;
  loadScanBase64: (key: string) => Promise<string | null>;
  newId: () => string;
  adminUsers: CognitoUserAdmin;
  metrics: MetricsPort;
  apiId: string;
};

export function route(deps: RouteDeps, event: ApiEvent): Promise<ApiResult> {
  return withErrorHandling(async () => {
    const { method, path, ownerId, pathParams, body } = event;

    if (path.startsWith('/public/')) {
      const result = await handlePublicRoute(
        { cars: deps.cars, events: deps.events },
        event,
      );
      if (result) return result;
    }

    if (!ownerId) return ok(401, { error: 'Unauthorized' });
    const id = pathParams.id;

    if (path.startsWith('/admin/')) {
      const result = await handleAdminRoute(
        { users: deps.adminUsers, metrics: deps.metrics, events: deps.events, apiId: deps.apiId },
        event,
      );
      if (result) return result;
    }

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

    if (id && path.startsWith(`/cars/${id}/events`)) {
      const result = await handleEventRoute(deps, event, ownerId, id);
      if (result) return result;
    }

    if (id && path.startsWith(`/cars/${id}/reminders`)) {
      const result = await handleReminderRoute({ cars: deps.cars, reminders: deps.reminders }, event, ownerId, id);
      if (result) return result;
    }

    if (id && path.startsWith(`/cars/${id}/chat`)) {
      const result = await handleChatRoute(
        {
          cars: deps.cars, events: deps.events, reminders: deps.reminders, sessions: deps.sessions,
          proofs: deps.proofs,
          storage: deps.storage, llm: deps.llm, loadS3Base64: deps.loadScanBase64, newId: deps.newId,
        },
        event, ownerId, id,
      );
      if (result) return result;
    }

    if (path === '/cars' && method === 'GET') return ok(200, await deps.cars.listByOwner(ownerId));
    if (path === '/cars' && method === 'POST') {
      const car = createCar(ownerId, CreateCarSchema.parse(body));
      return ok(201, await deps.cars.create(car));
    }
    if (id && path === `/cars/${id}/sharing` && method === 'PUT') {
      const { shared } = SetSharingSchema.parse(body);
      return ok(200, await deps.cars.setShared(ownerId, id, shared));
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
