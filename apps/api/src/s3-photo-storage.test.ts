import { describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted above imports, so the fake must be created via vi.hoisted.
const { createPresignedPost } = vi.hoisted(() => ({
  createPresignedPost: vi.fn(async () => ({ url: 'https://bucket.s3.amazonaws.com/', fields: { key: 'k', Policy: 'p' } })),
}));
vi.mock('@aws-sdk/s3-presigned-post', () => ({ createPresignedPost }));

import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
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

describe('S3PhotoStorage.deletePrefix', () => {
  it('lists every page under the prefix and deletes in quiet batches', async () => {
    const sent: unknown[] = [];
    const send = vi.fn(async (cmd: unknown) => {
      sent.push(cmd);
      if (cmd instanceof ListObjectsV2Command) {
        return cmd.input.ContinuationToken
          ? { Contents: [{ Key: 'proofs/u1/c' }], IsTruncated: false }
          : { Contents: [{ Key: 'proofs/u1/a' }, { Key: 'proofs/u1/b' }], IsTruncated: true, NextContinuationToken: 't2' };
      }
      return {};
    });
    const storage = new S3PhotoStorage('bucket', { send } as unknown as S3Client);
    await expect(storage.deletePrefix('proofs/u1/')).resolves.toBe(3);
    const deletes = sent.filter((c): c is DeleteObjectsCommand => c instanceof DeleteObjectsCommand);
    expect(deletes).toHaveLength(2);
    expect(deletes[0]?.input.Delete).toEqual({ Objects: [{ Key: 'proofs/u1/a' }, { Key: 'proofs/u1/b' }], Quiet: true });
    expect(deletes[1]?.input.Delete).toEqual({ Objects: [{ Key: 'proofs/u1/c' }], Quiet: true });
    const lists = sent.filter((c): c is ListObjectsV2Command => c instanceof ListObjectsV2Command);
    expect(lists.map((l) => l.input.Prefix)).toEqual(['proofs/u1/', 'proofs/u1/']);
  });
});
