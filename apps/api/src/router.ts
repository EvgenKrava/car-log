import { CreateCarSchema } from '@carlog/contracts';
import { CarNotFoundError, createCar, type CarRepository } from '@carlog/domain';
import { ok, withErrorHandling, type ApiResult } from './errors';

export type ApiEvent = {
  method: string;
  path: string;
  ownerId: string | null;
  pathParams: Record<string, string>;
  body: unknown;
};

export function route(repo: CarRepository, event: ApiEvent): Promise<ApiResult> {
  return withErrorHandling(async () => {
    const { method, path, ownerId, pathParams, body } = event;
    if (!ownerId) return ok(401, { error: 'Unauthorized' });
    const id = pathParams.id;

    if (path === '/cars' && method === 'GET') return ok(200, await repo.listByOwner(ownerId));
    if (path === '/cars' && method === 'POST') {
      const car = createCar(ownerId, CreateCarSchema.parse(body));
      return ok(201, await repo.create(car));
    }
    if (id && method === 'PUT') return ok(200, await repo.update(ownerId, id, CreateCarSchema.parse(body)));
    if (id && method === 'DELETE') { await repo.delete(ownerId, id); return ok(204, null); }
    if (id && method === 'GET') {
      const car = await repo.getById(ownerId, id);
      if (!car) throw new CarNotFoundError(id);
      return ok(200, car);
    }
    return ok(404, { error: 'NoRoute' });
  });
}
