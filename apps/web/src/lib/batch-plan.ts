export type BatchItemPlan =
  | { file: File; status: 'accepted' }
  | { file: File; status: 'skipped'; reasonKey: string; params?: Record<string, unknown> };

export function planBatch(
  files: File[],
  remaining: number,
  validateOne: (f: { type: string; size: number }, countSoFar: number) => { key: string; params?: Record<string, unknown> } | null,
): BatchItemPlan[] {
  let accepted = 0;
  return files.map((file) => {
    // Cap check first: a file over the remaining cap is `skipped` with the validator's
    // own cap reason key (never hardcoded here). The validator emits the cap key when
    // countSoFar >= max, so we pass `remaining` to reuse that message.
    if (accepted >= remaining) {
      const capErr = validateOne({ type: file.type, size: file.size }, remaining);
      return { file, status: 'skipped', reasonKey: capErr?.key ?? 'tooMany', params: capErr?.params };
    }
    const err = validateOne({ type: file.type, size: file.size }, accepted);
    if (err) return { file, status: 'skipped', reasonKey: err.key, params: err.params };
    accepted += 1;
    return { file, status: 'accepted' };
  });
}
