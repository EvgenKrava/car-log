import { CreateCarSchema } from '@carlog/contracts';
import { CarNotFoundError, createCar, type CarRepository, type PhotoRepository, type PhotoStorage } from '@carlog/domain';
import { ok, withErrorHandling, type ApiResult } from './errors';
import { handlePhotoRoute } from './photo-routes';

export type ApiEvent = {
  method: string;
  path: string;
  ownerId: string | null;
  pathParams: Record<string, string>;
  body: unknown;
};

export type RouteDeps = { cars: CarRepository; photos: PhotoRepository; storage: PhotoStorage };

export function route(deps: RouteDeps, event: ApiEvent): Promise<ApiResult> {
  return withErrorHandling(async () => {
    const { method, path, ownerId, pathParams, body } = event;
    if (!ownerId) return ok(401, { error: 'Unauthorized' });
    const id = pathParams.id;

    // Photo sub-routes: /cars/{id}/photos*
    if (id && path.startsWith(`/cars/${id}/photos`)) {
      const result = await handlePhotoRoute(deps, event, ownerId, id);
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
