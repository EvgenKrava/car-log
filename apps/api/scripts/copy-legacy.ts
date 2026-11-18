/**
 * Copies CarLog data from the old CDK stack into the Terraform stack, read-only on the old side.
 *
 *   pnpm --filter @carlog/api copy-legacy            # dry run: prints what it would copy
 *   pnpm --filter @carlog/api copy-legacy --apply    # copies
 *
 * Rows and files are copied unchanged (still keyed by the old CarLog sub). For each old user
 * a marker LEGACY#<email> is written; the API's GET /me re-keys the data to the user's
 * Only Tools sub on their first sign-in (src/legacy-claim.ts). Safe to re-run: it overwrites.
 * Users whose marker was already claimed are skipped, so a re-run never resurrects old rows.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, ListObjectsV2Command, CopyObjectCommand } from '@aws-sdk/client-s3';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { claimedKey, legacyKey } from '../src/legacy-claim';

const OLD = { table: 'CarLogStack-CarLogTable68A42622-UT12WI5VT13G', bucket: 'carlogstack-photosbucket2ac9d1f0-yg89yqkb76dh', pool: 'us-east-1_9rAPEPc5f' };
const NEW = { table: 'carlog', bucket: 'carlog-photos-898836755334' };
const apply = process.argv.includes('--apply');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const cognito = new CognitoIdentityProviderClient({});

type Item = Record<string, unknown> & { PK: string; SK: string };

async function scanAll(table: string): Promise<Item[]> {
  const out: Item[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await db.send(new ScanCommand({ TableName: table, ExclusiveStartKey }));
    out.push(...((r.Items ?? []) as Item[]));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

async function oldEmails(): Promise<Map<string, string>> {
  const bySub = new Map<string, string>();
  let PaginationToken: string | undefined;
  do {
    const r = await cognito.send(new ListUsersCommand({ UserPoolId: OLD.pool, PaginationToken }));
    for (const u of r.Users ?? []) {
      const a = (n: string) => u.Attributes?.find((x) => x.Name === n)?.Value;
      const sub = a('sub'); const email = a('email');
      if (sub && email) bySub.set(sub, email.trim().toLowerCase());
    }
    PaginationToken = r.PaginationToken;
  } while (PaginationToken);
  return bySub;
}

async function main() {
  const [items, emails] = await Promise.all([scanAll(OLD.table), oldEmails()]);
  const owners = new Map<string, Item[]>();
  const shares = new Map<string, string[]>();
  const other: Item[] = [];
  for (const i of items) {
    const m = /^USER#(.+)$/.exec(i.PK);
    if (m) { owners.set(m[1], [...(owners.get(m[1]) ?? []), i]); continue; }
    if (i.PK.startsWith('SHARE#') && typeof i.ownerId === 'string') shares.set(i.ownerId, [...(shares.get(i.ownerId) ?? []), String(i.carId)]);
    other.push(i);
  }

  // Share rows of an already-moved user point at the new sub; copying them again would undo that.
  const movedSubs = new Set<string>();
  for (const [sub] of owners) {
    const email = emails.get(sub);
    if (email && (await db.send(new GetCommand({ TableName: NEW.table, Key: claimedKey(email) }))).Item) movedSubs.add(sub);
  }
  const toCopy: Item[] = other.filter((i) => !(i.PK.startsWith('SHARE#') && movedSubs.has(String(i.ownerId))));
  const markers = new Map<string, Item & { oldSubs: string[]; shareCarIds: string[] }>();
  for (const [sub, rows] of owners) {
    const email = emails.get(sub);
    if (!email) { console.log(`skip ${rows.length} rows: old user ${sub.slice(0, 8)}… no longer exists`); continue; }
    const done = await db.send(new GetCommand({ TableName: NEW.table, Key: claimedKey(email) }));
    if (done.Item) { console.log(`skip ${email.replace(/(.).*@/, '$1…@')}: already moved to the new sign-in`); continue; }
    console.log(`user ${email.replace(/(.).*@/, '$1…@')} (${sub.slice(0, 8)}): ${rows.length} rows, ${shares.get(sub)?.length ?? 0} shared cars`);
    toCopy.push(...rows);
    const m = markers.get(email) ?? { ...legacyKey(email), oldSubs: [], shareCarIds: [] };
    m.oldSubs.push(sub); m.shareCarIds.push(...(shares.get(sub) ?? []));
    markers.set(email, m);
  }

  const files: string[] = [];
  let ContinuationToken: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: OLD.bucket, ContinuationToken }));
    for (const o of r.Contents ?? []) if (o.Key) files.push(o.Key);
    ContinuationToken = r.NextContinuationToken;
  } while (ContinuationToken);

  console.log(`\n${toCopy.length} rows, ${markers.size} sign-in markers, ${files.length} files${apply ? '' : ' (dry run, pass --apply)'}`);
  if (!apply) return;

  for (const Item of [...toCopy, ...markers.values()]) await db.send(new PutCommand({ TableName: NEW.table, Item }));
  for (const Key of files) {
    await s3.send(new CopyObjectCommand({ Bucket: NEW.bucket, Key, CopySource: `${OLD.bucket}/${encodeURIComponent(Key).replace(/%2F/g, '/')}` }));
  }
  console.log('copied');
}

main().catch((e) => { console.error(e); process.exit(1); });
