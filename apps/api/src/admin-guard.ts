// Roles in the shared Only Tools pool. `carlog-user` opens the app; `carlog-admin` adds the
// admin pages. Both are granted from the Only Tools admin (onlytools.click/admin).
export const ADMIN_GROUP = 'carlog-admin';
export const ACCESS_GROUP = 'carlog-user';

// The `cognito:groups` claim reaches us in several shapes depending on token
// source and API Gateway serialization: a real array, a JSON array string, a
// space-separated bracketed string (`"[admin staff]"`), or a bare string.
export function parseGroups(claim: unknown): string[] {
  if (Array.isArray(claim)) return claim.map(String).filter(Boolean);
  if (typeof claim !== 'string' || claim.trim() === '') return [];
  const trimmed = claim.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // Not JSON — the API Gateway "[a b c]" form. Strip brackets, split on comma/space.
    }
    return trimmed.slice(1, -1).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  return [trimmed];
}

export function isAdmin(groups: string[]): boolean {
  return groups.includes(ADMIN_GROUP);
}

export function hasAccess(groups: string[]): boolean {
  return groups.includes(ACCESS_GROUP) || groups.includes(ADMIN_GROUP);
}
