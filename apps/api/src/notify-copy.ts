import type { Car } from '@carlog/contracts';
import { nowIso, type NotifyCondition } from '@carlog/domain';

export type PushPayload = { title: string; body: string; url: string };

// Server-side copy table, NOT an i18n framework: two languages, plain constants. The
// notify worker has no browser i18n context, and pulling in a full i18n library for two
// push-notification strings would be overkill.
type Lang = 'uk' | 'en';

const carName = (car: Car): string => car.nickname || `${car.make} ${car.model}`;

const mileageBody = (daysStale: number, lang: Lang): string =>
  lang === 'uk'
    ? `Пробіг не оновлювався ${daysStale} дн. Торкніться, щоб оновити.`
    : `Odometer not updated in ${daysStale} days. Tap to update.`;

// Whole days between two YYYY-MM-DD (or ISO datetime) dates, UTC-anchored — same
// convention as packages/domain/src/notify.ts. Positive = dueDate is in the future.
const daysUntil = (today: string, dueDate: string): number => {
  const from = Date.parse(`${today.slice(0, 10)}T00:00:00.000Z`);
  const to = Date.parse(`${dueDate.slice(0, 10)}T00:00:00.000Z`);
  return Math.round((to - from) / 86_400_000);
};

// "In N km" / "N km overdue" — km ≤ 0 means the due mileage has already passed.
const kmTargetBody = (n: number, lang: Lang): string => {
  if (n <= 0) return lang === 'uk' ? `Прострочено на ${-n} км` : `${-n} km overdue`;
  return lang === 'uk' ? `За ${n} км` : `In ${n} km`;
};

// "In N days" / "N days overdue" — mirrors kmTargetBody; days ≤ 0 means today >= dueDate.
const dateTargetBody = (n: number, lang: Lang): string => {
  if (n <= 0) return lang === 'uk' ? `Прострочено на ${-n} дн.` : `${-n} days overdue`;
  return lang === 'uk' ? `За ${n} дн.` : `In ${n} days`;
};

// When both targets are set, the km target drives the body (matches the anchor
// convention: whichever target is closer/more urgent is what the user cares about; km
// is preferred as the more actionable/precise of the two when both exist).
const reminderBody = (nearest: { dueDate?: string; dueMileage?: number }, car: Car, lang: Lang, today: string): string => {
  if (nearest.dueMileage !== undefined) return kmTargetBody(nearest.dueMileage - car.mileage, lang);
  if (nearest.dueDate !== undefined) return dateTargetBody(daysUntil(today, nearest.dueDate), lang);
  return ''; // unreachable: evaluateCarConditions never emits a reminders condition without a target
};

// `today` defaults to the real current date — it's only needed for the reminders/date
// variant (km needs no clock) and is exposed as an optional param purely so tests can
// pin it instead of mocking the system clock.
export function notifyCopy(cond: NotifyCondition, car: Car, lang: Lang, today: string = nowIso().slice(0, 10)): PushPayload {
  if (cond.type === 'mileage') {
    return {
      title: `🚗 ${carName(car)}`,
      body: mileageBody(cond.daysStale ?? 0, lang),
      url: `/cars/${car.id}?odometer=1`,
    };
  }

  const nearest = cond.nearest;
  return {
    title: `🔧 ${nearest?.title ?? ''}`,
    body: nearest ? reminderBody(nearest, car, lang, today) : '',
    url: `/cars/${car.id}?tab=reminders`,
  };
}
