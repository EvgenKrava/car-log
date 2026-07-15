import { describe, expect, it } from 'vitest';
import { formatCost } from './format-cost';

describe('formatCost', () => {
  it('returns empty string for zero cost', () => {
    expect(formatCost(0, 'UAH', 'en')).toBe('');
  });
  it('returns empty string for negative cost', () => {
    expect(formatCost(-5, 'UAH', 'en')).toBe('');
  });
  it('formats a positive cost with currency', () => {
    const out = formatCost(1200, 'UAH', 'en');
    expect(out).toContain('UAH');
    expect(out).toMatch(/1,?200/);
  });
});