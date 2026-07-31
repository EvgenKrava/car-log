import type { Car, Event, PublicCar } from '@carlog/contracts';

export function toPublicCar(car: Car, events: Event[]): PublicCar {
  return {
    id: car.id,
    make: car.make,
    model: car.model,
    year: car.year,
    nickname: car.nickname,
    fuelType: car.fuelType,
    engineVolume: car.engineVolume,
    mileage: car.mileage,
    vin: car.vin,
    licensePlate: car.licensePlate,
    events: events.map((e) => ({
      id: e.id,
      date: e.date,
      category: e.category,
      mileage: e.mileage,
      cost: e.cost,
      currency: e.currency,
      title: e.title,
      notes: e.notes,
      works: e.works,
    })),
  };
}
