import { describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted above imports, so the fake must be created via vi.hoisted.
const { createPresignedPost } = vi.hoisted(() => ({
  createPresignedPost: vi.fn(async () => ({ url: 'https://bucket.s3.amazonaws.com/', fields: { key: 'k', Policy: 'p' } })),
}));
vi.mock('@aws-sdk/s3-presigned-post', () => ({ createPresignedPost }));

import { S3Client } from '@aws-sdk/client-s3';
import { S3PhotoStorage } from './s3-photo-storage';

describe('S3PhotoStorage.presignUpload', () => {
  it('signs a POST with content-length-range and exact content type', async () => {
    const storage = new S3PhotoStorage('bucket', new S3Client({}));
    const res = await storage.presignUpload('proofs/u/c/e/p', 'image/jpeg', 1000);
    expect(res).toEqual({ url: 'https://bucket.s3.amazonaws.com/', fields: { key: 'k', Policy: 'p' } });
    expect(createPresignedPost).toHaveBeenCalledWith(expect.any(S3Client), {
      Bucket: 'bucket', Key: 'proofs/u/c/e/p', Expires: 3600,
      Fields: { 'Content-Type': 'image/jpeg' },
      Conditions: [['content-length-range', 1, 1000], ['eq', '$Content-Type', 'image/jpeg']],
    });
  });
});
