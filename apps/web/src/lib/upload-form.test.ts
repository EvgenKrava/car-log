import { describe, expect, it } from 'vitest';
import { buildUploadForm } from './upload-form';

describe('buildUploadForm', () => {
  it('appends signed fields in order and the file last', () => {
    const form = buildUploadForm({ url: 'https://b.s3/', fields: { key: 'k', Policy: 'p', 'Content-Type': 'image/png' } }, new Blob(['x']));
    expect([...form.keys()]).toEqual(['key', 'Policy', 'Content-Type', 'file']);
  });
});
