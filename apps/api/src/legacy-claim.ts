import { BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CopyObjectCommand, DeleteObjectCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { OWNER_PREFIXES } from '@carlog/domain';

// CarLog moved from its own Cognito pool to the shared Only Tools pool, which gives every
// user a new `sub`. The migration script copies each old user's rows and files unchanged
// and leaves a marker `LEGACY#<email>` holding the old sub. The first time the same,
// verified email signs in through the shared pool, its data is re-keyed to the new sub.

type Item = Record<string, unknown> & { PK: string; SK: string };
// One email can own several old accounts (e.g. Google and a password sign-in); all are merged.
export type LegacyMarker = { PK: string; SK: 'LEGACY'; oldSubs: string[]; shareCarIds?: string[] };

export const legacyKey = (email: string) => ({ PK: `LEGACY#${email.trim().toLowerCase()}`, SK: 'LEGACY' });
/** Written once the move is done, so the copy script never brings the old rows back. */
export const claimedKey = (email: string) => ({ PK: `LEGACYDONE#${email.trim().toLowerCase()}`, SK: 'LEGACY' });

/** Rewrites every occurrence of the old sub inside an item (keys, ownerId, S3 keys). */
export function rekey<T>(item: T, oldSub: string, newSub: string): T {
  return JSON.parse(JSON.stringify(item).split(oldSub).join(newSub)) as T;
}

export interface EmailLookup {
  /** The user's email when it is verified, else null. */
  verifiedEmail(username: string): Promise<string | null>;
}

export class LegacyClaim {
  constructor(
    private readonly table: string,
    private readonly db: DynamoDBDocumentClient,
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly emails: EmailLookup,
  ) {}

  /** Moves legacy data to `newSub`. Returns the number of rows moved (0 when there is nothing). */
  async claim(newSub: string, username: string): Promise<number> {
    const email = await this.emails.verifiedEmail(username);
    if (!email) return 0;
    const marker = (await this.db.send(new GetCommand({ TableName: this.table, Key: legacyKey(email) }))).Item as LegacyMarker | undefined;
    if (!marker) return 0;

    let moved = 0;
    for (const oldSub of marker.oldSubs.filter((o) => o !== newSub)) {
      moved += await this.moveRows(oldSub, newSub);
      // Public share rows live outside the owner partition and name the owner.
      for (const carId of marker.shareCarIds ?? []) {
        const res = await this.db.send(new QueryCommand({
          TableName: this.table, KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': `SHARE#${carId}` },
        }));
        for (const i of (res.Items ?? []) as Item[]) {
          if (i.ownerId === oldSub) await this.db.send(new PutCommand({ TableName: this.table, Item: rekey(i, oldSub, newSub) }));
        }
      }
      for (const prefix of OWNER_PREFIXES) await this.moveFiles(`${prefix}${oldSub}/`, `${prefix}${newSub}/`);
    }

    // Last, so a failure part-way leaves the marker for the next sign-in to finish the job.
    await this.db.send(new PutCommand({ TableName: this.table, Item: { ...claimedKey(email), newSub, at: new Date().toISOString() } }));
    await this.db.send(new DeleteCommand({ TableName: this.table, Key: legacyKey(email) }));
    return moved;
  }

  private async moveRows(oldSub: string, newSub: string): Promise<number> {
    let moved = 0;
    let cursor: Record<string, unknown> | undefined;
    do {
      const page = await this.db.send(new QueryCommand({
        TableName: this.table, KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `USER#${oldSub}` }, ExclusiveStartKey: cursor,
      }));
      const items = (page.Items ?? []) as Item[];
      await this.batch(items.map((i) => ({ PutRequest: { Item: rekey(i, oldSub, newSub) } })));
      await this.batch(items.map((i) => ({ DeleteRequest: { Key: { PK: i.PK, SK: i.SK } } })));
      moved += items.length;
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    return moved;
  }

  private async moveFiles(from: string, to: string): Promise<void> {
    let token: string | undefined;
    do {
      const page = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: from, ContinuationToken: token }));
      for (const o of page.Contents ?? []) {
        if (!o.Key) continue;
        const target = to + o.Key.slice(from.length);
        await this.s3.send(new CopyObjectCommand({
          Bucket: this.bucket, Key: target, CopySource: `${this.bucket}/${encodeURIComponent(o.Key).replace(/%2F/g, '/')}`,
        }));
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: o.Key }));
      }
      token = page.NextContinuationToken;
    } while (token);
  }

  // BatchWriteItem takes 25 requests; retry whatever DynamoDB leaves unprocessed.
  private async batch(requests: Record<string, unknown>[]): Promise<void> {
    for (let i = 0; i < requests.length; i += 25) {
      let pending = requests.slice(i, i + 25);
      while (pending.length) {
        const res = await this.db.send(new BatchWriteCommand({ RequestItems: { [this.table]: pending } }));
        pending = (res.UnprocessedItems?.[this.table] ?? []) as typeof pending;
      }
    }
  }
}
