import { describe, expect, it } from 'vitest';
import { formatNumber } from './format';

describe('formatNumber', () => {
  it('groups thousands for en with commas', () => {
    expect(formatNumber(45000, 'en')).toBe('45,000');
  });
  it('groups thousands for uk with non-breaking/thin spaces (not commas)', () => {
    const out = formatNumber(45000, 'uk');
    expect(out).not.toContain(',');
    expect(out.replace(/\s/g, '')).toBe('45000');
  });
});
