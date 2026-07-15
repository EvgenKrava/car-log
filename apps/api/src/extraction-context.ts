import type { Car, Event } from '@carlog/contracts';
import type { ExtractionContext, EventRepository } from '@carlog/domain';

// How many recent (date, mileage) points to hand the model for date-from-mileage estimation.
const HISTORY_POINTS = 12;

// Build the extraction context for a car: identity plus recent timeline points (newest
// first) that carry a real mileage, so the model can estimate an undated event's date by
// interpolating against known odometer readings.
export async function buildExtractionContext(
  events: EventRepository, ownerId: string, car: Car,
): Promise<ExtractionContext> {
  const existing = await events.listByCar(ownerId, car.id);
  const history = existing
    .filter((e: Event) => e.mileage > 0 && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
    .sort((a: Event, b: Event) => (a.date < b.date ? 1 : -1))
    .slice(0, HISTORY_POINTS)
    .map((e: Event) => ({ date: e.date, mileage: e.mileage }));
  return { car: { make: car.make, model: car.model, year: car.year }, history };
}
