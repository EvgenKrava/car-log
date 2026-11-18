// One-off smoke test of LegacyClaim against the real Terraform table and bucket, using
// synthetic users only (test-old-*, test-new-*). Cleans up after itself.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { LegacyClaim, legacyKey, claimedKey } from '../src/legacy-claim';

const T = 'carlog', B = 'carlog-photos-898836755334';
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const oldA = `test-old-a-${Date.now()}`, oldB = `test-old-b-${Date.now()}`, neu = `test-new-${Date.now()}`;
const email = `smoke-${Date.now()}@example.invalid`;

await db.send(new PutCommand({ TableName: T, Item: { PK: `USER#${oldA}`, SK: 'CAR#c1', ownerId: oldA } }));
await db.send(new PutCommand({ TableName: T, Item: { PK: `USER#${oldB}`, SK: 'CAR#c2', ownerId: oldB, photo: `proofs/${oldB}/c2/e/p` } }));
await db.send(new PutCommand({ TableName: T, Item: { PK: 'SHARE#c2', SK: 'SHARE', carId: 'c2', ownerId: oldB } }));
await db.send(new PutCommand({ TableName: T, Item: { ...legacyKey(email), oldSubs: [oldA, oldB], shareCarIds: ['c2'] } }));
await s3.send(new PutObjectCommand({ Bucket: B, Key: `proofs/${oldB}/c2/e/p`, Body: 'x' }));

const claim = new LegacyClaim(T, db, s3, B, { verifiedEmail: async () => email });
const moved = await claim.claim(neu, 'whoever');
const rows = (await db.send(new QueryCommand({ TableName: T, KeyConditionExpression: 'PK = :p', ExpressionAttributeValues: { ':p': `USER#${neu}` } }))).Items ?? [];
const oldLeft = (await db.send(new QueryCommand({ TableName: T, KeyConditionExpression: 'PK = :p', ExpressionAttributeValues: { ':p': `USER#${oldB}` } }))).Count;
const share = (await db.send(new GetCommand({ TableName: T, Key: { PK: 'SHARE#c2', SK: 'SHARE' } }))).Item;
const marker = (await db.send(new GetCommand({ TableName: T, Key: legacyKey(email) }))).Item;
const done = (await db.send(new GetCommand({ TableName: T, Key: claimedKey(email) }))).Item;
const fileMoved = await s3.send(new HeadObjectCommand({ Bucket: B, Key: `proofs/${neu}/c2/e/p` })).then(() => true, () => false);
const fileOld = await s3.send(new HeadObjectCommand({ Bucket: B, Key: `proofs/${oldB}/c2/e/p` })).then(() => true, () => false);
const again = await claim.claim(neu, 'whoever');

console.log({ moved, rows: rows.map((r) => `${r.SK}:${r.ownerId}:${r.photo ?? ''}`.replace(neu, 'NEW').replace(neu, 'NEW')), oldLeft, shareOwnerIsNew: share?.ownerId === neu, markerGone: !marker, doneWritten: done?.newSub === neu, fileMoved, fileOld, secondRunMoved: again });

for (const r of rows) await db.send(new DeleteCommand({ TableName: T, Key: { PK: r.PK, SK: r.SK } }));
for (const Key of [{ PK: 'SHARE#c2', SK: 'SHARE' }, claimedKey(email)]) await db.send(new DeleteCommand({ TableName: T, Key }));
await s3.send(new DeleteObjectCommand({ Bucket: B, Key: `proofs/${neu}/c2/e/p` }));
