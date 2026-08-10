import { describe, expect, it } from 'vitest';
import type { Car } from '@carlog/contracts';
import type { NotifyCondition } from '@carlog/domain';
import { notifyCopy } from './notify-copy';

const car = (over: Partial<Car> = {}): Car => ({
  id: '11111111-1111-4111-8111-111111111111',
  ownerId: 'u1',
  make: 'VW',
  model: 'Golf',
  year: 2018,
  mileage: 50000,
  fuelType: 'diesel',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  mileageUpdatedAt: '2026-08-01T00:00:00.000Z',
  shared: false,
  ...over,
});

describe('notifyCopy — mileage', () => {
  const cond: NotifyCondition = { carId: car().id, type: 'mileage', daysStale: 8 };

  it('titles with the nickname when present (en)', () => {
    const result = notifyCopy(cond, car({ nickname: 'Галя' }), 'en');
    expect(result.title).toBe('🚗 Галя');
    expect(result.body).toBe('Odometer not updated in 8 days. Tap to update.');
    expect(result.url).toBe(`/cars/${car().id}?odometer=1`);
  });

  it('titles with make+model when no nickname (uk)', () => {
    const result = notifyCopy(cond, car({ nickname: undefined }), 'uk');
    expect(result.title).toBe('🚗 VW Golf');
    expect(result.body).toBe('Пробіг не оновлювався 8 дн. Торкніться, щоб оновити.');
  });
});

describe('notifyCopy — reminders', () => {
  const baseCond = (nearest: NotifyCondition['nearest']): NotifyCondition => ({
    carId: car().id, type: 'reminders', nearest,
  });

  it('km variant, upcoming (en)', () => {
    const result = notifyCopy(baseCond({ title: 'Oil change', dueMileage: 50500 }), car({ mileage: 50000 }), 'en');
    expect(result.title).toBe('🔧 Oil change');
    expect(result.body).toBe('In 500 km');
    expect(result.url).toBe(`/cars/${car().id}?tab=reminders`);
  });

  it('km variant, overdue (uk)', () => {
    const result = notifyCopy(baseCond({ title: 'Заміна оливи', dueMileage: 49500 }), car({ mileage: 50000 }), 'uk');
    expect(result.body).toBe('Прострочено на 500 км');
  });

  it('date variant, upcoming (en)', () => {
    const result = notifyCopy(baseCond({ title: 'Inspection', dueDate: '2026-08-10' }), car(), 'en', '2026-08-05');
    expect(result.body).toBe('In 5 days');
  });

  it('date variant, overdue (uk)', () => {
    const result = notifyCopy(baseCond({ title: 'Техогляд', dueDate: '2026-08-01' }), car(), 'uk', '2026-08-05');
    expect(result.body).toBe('Прострочено на 4 дн.');
  });

  it('when both targets exist, the km one wins', () => {
    const result = notifyCopy(
      baseCond({ title: 'Both', dueDate: '2026-08-10', dueMileage: 50200 }),
      car({ mileage: 50000 }),
      'en',
      '2026-08-05',
    );
    expect(result.body).toBe('In 200 km');
  });
});
