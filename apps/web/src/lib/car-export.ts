import {
  CAR_EXPORT_FORMAT, CAR_EXPORT_VERSION, CarExportSchema,
  type Car, type Event, type Reminder, type CarExport,
} from '@carlog/contracts';

// Mirrors packages/domain/src/car-export.ts toCarExport — the domain package isn't
// browser-safe (node:crypto), so the mapping is duplicated here (same convention as
// reminder-view.ts). Explicit field mapping (never spread-and-delete) so server-owned
// identifiers can't leak into the file. The final `CarExportSchema.parse` is the
// correctness backstop: an invalid export can never be downloaded, even if this mapper
// and the domain reference implementation drift.
export function buildCarExport(
  car: Car, events: Event[], reminders: Reminder[], exportedAt: string,
): CarExport {
  const file = {
    format: CAR_EXPORT_FORMAT,
    version: CAR_EXPORT_VERSION,
    exportedAt,
    attachments: 'not-included' as const,
    car: {
      make: car.make, model: car.model, year: car.year, mileage: car.mileage,
      fuelType: car.fuelType, engineVolume: car.engineVolume,
      nickname: car.nickname, vin: car.vin, licensePlate: car.licensePlate,
    },
    events: [...events]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) // newest first
      .map((e) => ({
        date: e.date, mileage: e.mileage, cost: e.cost, currency: e.currency,
        category: e.category, title: e.title, notes: e.notes,
        works: e.works.map((w) => ({
          description: w.description,
          parts: w.parts.map((p) => ({
            name: p.name, brand: p.brand, partNumber: p.partNumber,
            quantity: p.quantity, notes: p.notes, purchaseLink: p.purchaseLink,
          })),
        })),
      })),
    reminders: reminders.map((r) => ({
      title: r.title, category: r.category, notes: r.notes,
      dueDate: r.dueDate, dueMileage: r.dueMileage,
      repeatMonths: r.repeatMonths, repeatKm: r.repeatKm,
    })),
  };
  return CarExportSchema.parse(file);
}
