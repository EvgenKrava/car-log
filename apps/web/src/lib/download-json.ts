// Trigger a client-side download of `data` as pretty-printed JSON. Object URL is
// revoked after the click so repeated exports don't leak blobs.
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// carlog-<make>-<model>-<YYYY-MM-DD>.json, lowercased, non-alphanumerics dashed.
// Unicode-aware (\p{L}\p{N}) so non-Latin makes/models (e.g. Cyrillic "ВАЗ Ока")
// keep their letters instead of being stripped to an empty, meaningless slug.
export function exportFilename(make: string, model: string, dateISO: string): string {
  const slug = `${make}-${model}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return `carlog-${slug || 'car'}-${dateISO}.json`;
}
