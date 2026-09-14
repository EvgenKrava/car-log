import {
  S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, CopyObjectCommand, ListObjectsV2Command, DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import type { PresignedUpload } from '@carlog/contracts';
import type { PhotoStorage } from '@carlog/domain';

const PRESIGN_TTL_SECONDS = 3600; // 1 hour

export class S3PhotoStorage implements PhotoStorage {
  constructor(private readonly bucket: string, private readonly client: S3Client) {}

  // Presigned POST (not PUT): only a POST policy can bound the object size server-side.
  async presignUpload(key: string, contentType: string, maxSize: number): Promise<PresignedUpload> {
    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: this.bucket, Key: key, Expires: PRESIGN_TTL_SECONDS,
      Fields: { 'Content-Type': contentType },
      Conditions: [['content-length-range', 1, maxSize], ['eq', '$Content-Type', contentType]],
    });
    return { url, fields };
  }

  async presignGet(key: string): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: PRESIGN_TTL_SECONDS });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && ('name' in err && err.name === 'NotFound' || '$metadata' in err && typeof err.$metadata === 'object' && err.$metadata !== null && 'httpStatusCode' in err.$metadata && err.$metadata.httpStatusCode === 404)) {
        return false;
      }
      throw err;
    }
  }

  async copyObject(srcKey: string, destKey: string): Promise<void> {
    await this.client.send(new CopyObjectCommand({
      Bucket: this.bucket, CopySource: `${this.bucket}/${srcKey}`, Key: destKey,
    }));
  }

  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (keys.length > 0) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }));
        deleted += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }
}
