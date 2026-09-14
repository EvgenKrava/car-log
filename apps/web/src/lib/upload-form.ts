import type { PresignedUpload } from '@carlog/contracts';

// S3 POST policy: every signed field first, the file LAST — S3 ignores fields after it.
export function buildUploadForm(upload: PresignedUpload, file: Blob): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
  form.append('file', file);
  return form;
}
