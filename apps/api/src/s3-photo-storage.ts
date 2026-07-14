import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PhotoStorage } from '@carlog/domain';

const PRESIGN_TTL_SECONDS = 3600; // 1 hour

export class S3PhotoStorage implements PhotoStorage {
  constructor(private readonly bucket: string, private readonly client: S3Client) {}

  async presignPut(key: string, contentType: string, maxSize: number): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: maxSize,
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
}
