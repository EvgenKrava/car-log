import { describe, expect, it } from 'vitest';
import { planBatch } from './batch-plan';

// A stub validator: rejects non-image types and files > 10, and emits an over-cap
// key when countSoFar >= 3 (mimics the real validators' shape).
const CAP = 3;
const validateOne = (f: { type: string; size: number }, count: number) => {
  if (count >= CAP) return { key: 'tooMany', params: { max: CAP } };
  if (!f.type.startsWith('image/')) return { key: 'badType' };
  if (f.size > 10) return { key: 'tooLarge' };
  return null;
};
const file = (name: string, type = 'image/jpeg', size = 5): File =>
  ({ name, type, size } as unknown as File);

describe('planBatch', () => {
  it('accepts all valid files under the cap', () => {
    const plan = planBatch([file('a'), file('b')], CAP, validateOne);
    expect(plan.map((p) => p.status)).toEqual(['accepted', 'accepted']);
  });
  it('truncates over the remaining cap', () => {
    const plan = planBatch([file('a'), file('b'), file('c'), file('d'), file('e')], 2, validateOne);
    expect(plan.filter((p) => p.status === 'accepted')).toHaveLength(2);
    const skipped = plan.filter((p) => p.status === 'skipped');
    expect(skipped).toHaveLength(3);
    expect(skipped).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'skipped', reasonKey: 'tooMany' })]),
    );
  });
  it('skips invalid type/size but still accepts valid ones', () => {
    const plan = planBatch([file('a'), file('bad', 'application/zip'), file('big', 'image/png', 999)], CAP, validateOne);
    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({ status: 'accepted' });
    expect(plan[1]).toMatchObject({ status: 'skipped', reasonKey: 'badType' });
    expect(plan[2]).toMatchObject({ status: 'skipped', reasonKey: 'tooLarge' });
  });
  it('returns [] for no files', () => {
    expect(planBatch([], CAP, validateOne)).toEqual([]);
  });
});
