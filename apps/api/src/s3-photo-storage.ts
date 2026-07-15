import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PhotoStorage } from '@carlog/domain';

const PRESIGN_TTL_SECONDS = 3600; // 1 hour

export class S3PhotoStorage implements PhotoStorage {
  constructor(private readonly bucket: string, private readonly client: S3Client) {}

  // maxSize is intentionally unused — signing ContentLength causes signature mismatches.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async presignPut(key: string, contentType: string, _maxSize: number): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket, Key: key, ContentType: contentType,
    });
    return getSignedUrl(this.client, cmd, { expiresIn: PRESIGN_TTL_SECONDS });
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
}
