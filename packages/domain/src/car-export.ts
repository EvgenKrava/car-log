import type { Car, Event, Reminder, CarExport } from '@carlog/contracts';
import { CAR_EXPORT_FORMAT, CAR_EXPORT_VERSION } from '@carlog/contracts';

// Build the portable export file. Explicit field mapping (never spread-and-delete), the
// same guard style as buildCarChatContext: server-owned identifiers can't leak because
// they are never copied. `exportedAt` is injected — the domain stays clock-free.
export function toCarExport(
  car: Car, events: Event[], reminders: Reminder[], exportedAt: string,
): CarExport {
  return {
    format: CAR_EXPORT_FORMAT,
    version: CAR_EXPORT_VERSION,
    exportedAt,
    attachments: 'not-included',
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
}
