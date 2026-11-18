import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_LIMITS, PlanLimitError, assertCanAddCar, consumeMonthlyScan, parsePlanLimits, planOf, quotaMonth } from './plan-limits';

describe('parsePlanLimits', () => {
  it('falls back to defaults for missing or broken JSON', () => {
    expect(parsePlanLimits(null)).toEqual(DEFAULT_PLAN_LIMITS);
    expect(parsePlanLimits('{nope')).toEqual(DEFAULT_PLAN_LIMITS);
  });
  it('reads the shared document, keeping null as unlimited', () => {
    const l = parsePlanLimits(JSON.stringify({ plusGroup: 'vip', apps: { carlog: { cars: { free: 3, plus: null }, ocrScansPerMonth: { free: 7, plus: 200 } }, foodlog: {} } }));
    expect(l).toEqual({ plusGroup: 'vip', carlog: { cars: { free: 3, plus: null }, ocrScansPerMonth: { free: 7, plus: 200 } } });
  });
  it('ignores invalid numbers field by field', () => {
    const l = parsePlanLimits(JSON.stringify({ apps: { carlog: { cars: { free: -1, plus: 'x' } } } }));
    expect(l.carlog.cars).toEqual(DEFAULT_PLAN_LIMITS.carlog.cars);
  });
});

describe('plans', () => {
  it('plus group gives Plus', () => {
    expect(planOf(['carlog-user', 'plus'], DEFAULT_PLAN_LIMITS)).toBe('plus');
    expect(planOf(['carlog-user'], DEFAULT_PLAN_LIMITS)).toBe('free');
  });
  it('car limit', () => {
    expect(() => assertCanAddCar(1, 'free', DEFAULT_PLAN_LIMITS)).not.toThrow();
    expect(() => assertCanAddCar(2, 'free', DEFAULT_PLAN_LIMITS)).toThrow(PlanLimitError);
    expect(() => assertCanAddCar(500, 'plus', DEFAULT_PLAN_LIMITS)).not.toThrow();
  });
  it('monthly scans use the YYYY-MM window', async () => {
    const calls: unknown[][] = [];
    const quota = { consume: async (...a: unknown[]) => { calls.push(a); return false; } };
    await expect(consumeMonthlyScan(quota as never, 'u1', 'free', DEFAULT_PLAN_LIMITS, new Date('2026-11-18T10:00:00Z'))).rejects.toMatchObject({ kind: 'ocrScansPerMonth', limit: 5 });
    expect(calls[0]).toEqual(['u1', 'ocr', 5, '2026-11']);
    expect(quotaMonth(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
  });
});
