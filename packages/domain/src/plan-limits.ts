// Only Tools plans: everyone is on Free; members of the Cognito group `plus` get Plus.
// The numbers live in SSM (/onlytools/plans/limits, owned by only-tools-core); these
// defaults apply until that parameter exists or when it cannot be read.
import type { UsageQuota } from './usage-quota';

export type Plan = 'free' | 'plus';
/** null = unlimited. */
export type PlanLimit = { free: number | null; plus: number | null };
export type CarLogPlanLimits = { cars: PlanLimit; ocrScansPerMonth: PlanLimit };
export type PlanLimits = { plusGroup: string; carlog: CarLogPlanLimits };

export const DEFAULT_PLAN_LIMITS: PlanLimits = {
  plusGroup: 'plus',
  carlog: { cars: { free: 2, plus: null }, ocrScansPerMonth: { free: 5, plus: 100 } },
};

const limitOf = (v: unknown, fallback: PlanLimit): PlanLimit => {
  const o = (v ?? {}) as Partial<Record<Plan, unknown>>;
  const one = (x: unknown, d: number | null) => (x === null ? null : typeof x === 'number' && x >= 0 ? x : d);
  return { free: one(o.free, fallback.free), plus: one(o.plus, fallback.plus) };
};

/** Parses the shared SSM JSON; any missing or malformed field keeps its default. */
export function parsePlanLimits(json: string | null | undefined): PlanLimits {
  if (!json) return DEFAULT_PLAN_LIMITS;
  let raw: { plusGroup?: unknown; apps?: { carlog?: { cars?: unknown; ocrScansPerMonth?: unknown } } };
  try { raw = JSON.parse(json); } catch { return DEFAULT_PLAN_LIMITS; }
  const d = DEFAULT_PLAN_LIMITS;
  const c = raw?.apps?.carlog;
  return {
    plusGroup: typeof raw?.plusGroup === 'string' && raw.plusGroup ? raw.plusGroup : d.plusGroup,
    carlog: { cars: limitOf(c?.cars, d.carlog.cars), ocrScansPerMonth: limitOf(c?.ocrScansPerMonth, d.carlog.ocrScansPerMonth) },
  };
}

export const planOf = (groups: readonly string[], limits: PlanLimits): Plan =>
  groups.includes(limits.plusGroup) ? 'plus' : 'free';

export type PlanLimitKind = 'cars' | 'ocrScansPerMonth';

/** The caller's plan does not allow this; the web app answers with an upgrade prompt. */
export class PlanLimitError extends Error {
  constructor(readonly kind: PlanLimitKind, readonly limit: number, readonly plan: Plan) {
    super(`Plan limit reached: ${kind} (${limit} on ${plan})`);
    this.name = 'PlanLimitError';
  }
}

/** Throws when an owner who already has `count` cars may not add another. */
export function assertCanAddCar(count: number, plan: Plan, limits: PlanLimits): void {
  const max = limits.carlog.cars[plan];
  if (max !== null && count >= max) throw new PlanLimitError('cars', max, plan);
}

// UTC calendar month — the OCR window.
export const quotaMonth = (now: Date = new Date()): string => now.toISOString().slice(0, 7);

/** Counts one receipt scan against the monthly allowance (atomic; never overshoots). */
export async function consumeMonthlyScan(
  quota: UsageQuota, ownerId: string, plan: Plan, limits: PlanLimits, now: Date = new Date(),
): Promise<void> {
  const max = limits.carlog.ocrScansPerMonth[plan];
  if (max === null) return;
  if (!(await quota.consume(ownerId, 'ocr', max, quotaMonth(now)))) throw new PlanLimitError('ocrScansPerMonth', max, plan);
}
