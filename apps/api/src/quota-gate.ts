import type { QuotaKind } from '@carlog/domain';

const CHAT_MESSAGES = /^\/cars\/[^/]+\/chat\/sessions\/[^/]+\/messages$/;
const TRANSCRIBE = /^\/cars\/[^/]+\/chat\/transcribe$/;

// Which daily quota (if any) a request consumes. Only the metered operations — the
// presign/list/read routes around them are free.
export function quotaKindFor(method: string, path: string): QuotaKind | null {
  if (method !== 'POST') return null;
  if (CHAT_MESSAGES.test(path)) return 'chat';
  if (TRANSCRIBE.test(path)) return 'transcribe';
  if (path === '/import/scan') return 'scan';
  if (path === '/import/extract') return 'extract';
  if (path === '/import/jobs') return 'import';
  return null;
}
