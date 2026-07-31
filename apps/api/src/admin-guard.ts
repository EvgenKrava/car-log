export const ADMIN_GROUP = 'admin';

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
