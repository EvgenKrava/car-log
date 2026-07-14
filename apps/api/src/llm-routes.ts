import { ExtractEventsRequestSchema } from '@carlog/contracts';
import { CarNotFoundError, extractEvents, type CarRepository, type LlmProvider } from '@carlog/domain';
import { ok, type ApiResult } from './errors';
import type { ApiEvent } from './router';

export type ImportDeps = { cars: CarRepository; llm: LlmProvider };

// Handles POST /import/extract?carId=<id> ; returns null if not matched.
// The carId is required (extraction context) and comes from a query-independent path:
// we accept it in the body alongside the text to keep the route flat.
export async function handleImportRoute(
  deps: ImportDeps, event: ApiEvent, ownerId: string,
): Promise<ApiResult | null> {
  const { method, path, body } = event;
  if (path !== '/import/extract' || method !== 'POST') return null;

  const b = (body ?? {}) as { carId?: unknown };
  const carId = typeof b.carId === 'string' ? b.carId : '';
  const car = await deps.cars.getById(ownerId, carId);
  if (!car) throw new CarNotFoundError(carId);

  const { text } = ExtractEventsRequestSchema.parse(body);
  const events = await extractEvents(text, deps.llm, {
    car: { make: car.make, model: car.model, year: car.year },
  });
  return ok(200, { events });
}
