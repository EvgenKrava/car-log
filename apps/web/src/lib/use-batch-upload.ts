import { useCallback, useEffect, useRef, useState } from 'react';
import { planBatch } from './batch-plan';

export type UploadState = 'queued' | 'uploading' | 'done' | 'failed' | 'skipped';
export type BatchItem = {
  id: string;
  name: string;
  state: UploadState;
  reasonKey?: string;
  params?: Record<string, unknown>;
};

const CONCURRENCY = 3;
// How long the finished status list stays visible. Failures/skips linger longer so the
// user can read the reason; an all-success batch clears quickly.
const DISMISS_OK_MS = 4000;
const DISMISS_ISSUES_MS = 10000;

type Opts = {
  upload: (file: File) => Promise<void>;
  validateOne: (f: { type: string; size: number }, count: number) => { key: string; params?: Record<string, unknown> } | null;
  remaining: () => number;
  onComplete: () => void;
};

export function useBatchUpload({ upload, validateOne, remaining, onComplete }: Opts) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const seq = useRef(0);

  const setState = (id: string, state: UploadState) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, state } : it)));

  const start = useCallback((files: File[]) => {
    if (!files.length) return;
    const plan = planBatch(files, remaining(), validateOne);
    const seeded: BatchItem[] = plan.map((p) => ({
      id: `${seq.current++}-${p.file.name}`,
      name: p.file.name,
      state: p.status === 'accepted' ? 'queued' : 'skipped',
      reasonKey: p.status === 'skipped' ? p.reasonKey : undefined,
      params: p.status === 'skipped' ? p.params : undefined,
    }));
    setItems(seeded);

    const queue = plan
      .map((p, i) => {
        const seededItem = seeded[i];
        if (!seededItem) return null;
        return { p, id: seededItem.id };
      })
      .filter((x): x is { p: typeof plan[number]; id: string } => x !== null && x.p.status === 'accepted');
    if (!queue.length) return;

    setRunning(true);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const idx = cursor++;
        if (idx >= queue.length) return;
        const item = queue[idx];
        if (!item) return;
        const { p, id } = item;
        setState(id, 'uploading');
        try {
          await upload(p.file);
          setState(id, 'done');
        } catch {
          setState(id, 'failed');
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()))
      .then(() => {
        setRunning(false);
        onComplete();
      });
  }, [upload, validateOne, remaining, onComplete]);

  const reset = useCallback(() => setItems([]), []);

  // Auto-dismiss the status list once the batch has settled (also covers all-skipped
  // batches, which never set `running`). Any new `start` resets the timer via deps.
  useEffect(() => {
    if (running || items.length === 0) return;
    const hasIssues = items.some((it) => it.state === 'failed' || it.state === 'skipped');
    const timer = setTimeout(() => setItems([]), hasIssues ? DISMISS_ISSUES_MS : DISMISS_OK_MS);
    return () => clearTimeout(timer);
  }, [running, items]);

  return { items, running, start, reset };
}
