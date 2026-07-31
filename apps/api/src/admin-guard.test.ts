import { describe, it, expect } from 'vitest';
import { parseGroups, isAdmin, ADMIN_GROUP } from './admin-guard';

describe('parseGroups', () => {
  it('handles a real array claim', () => {
    expect(parseGroups(['admin', 'staff'])).toEqual(['admin', 'staff']);
  });
  it('handles a JSON-array string claim', () => {
    expect(parseGroups('["admin","staff"]')).toEqual(['admin', 'staff']);
  });
  it('handles a bracketed non-JSON string claim (API Gateway form)', () => {
    expect(parseGroups('[admin staff]')).toEqual(['admin', 'staff']);
  });
  it('handles a single string claim', () => {
    expect(parseGroups('admin')).toEqual(['admin']);
  });
  it('returns [] for missing/empty', () => {
    expect(parseGroups(undefined)).toEqual([]);
    expect(parseGroups('')).toEqual([]);
    expect(parseGroups(null)).toEqual([]);
  });
});

describe('isAdmin', () => {
  it('is true when the admin group is present', () => {
    expect(isAdmin(['staff', ADMIN_GROUP])).toBe(true);
  });
  it('is false otherwise', () => {
    expect(isAdmin(['staff'])).toBe(false);
    expect(isAdmin([])).toBe(false);
  });
});
