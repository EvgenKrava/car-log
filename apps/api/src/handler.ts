import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2, Context,
} from 'aws-lambda';
import { IMPORT_FILE_MAX, MAX_SCAN_SIZE } from '@carlog/contracts';
import { DynamoCarRepository } from './dynamo-car-repository';
import { DynamoPhotoRepository } from './dynamo-photo-repository';
import { DynamoEventRepository } from './dynamo-event-repository';
import { DynamoProofRepository } from './dynamo-proof-repository';
import { DynamoReminderRepository } from './dynamo-reminder-repository';
import { DynamoImportJobRepository } from './import-job-repository';
import { S3PhotoStorage } from './s3-photo-storage';
import { BedrockLlmProvider } from './bedrock-llm-provider';
import { AwsCognitoUserAdmin } from './cognito-user-admin';
import { AwsCloudWatchMetrics } from './cloudwatch-metrics';
import { runImportJob, type ImportWorkPayload } from './import-worker';
import { route, type ApiEvent, type RouteDeps } from './router';
import { parseGroups } from './admin-guard';

const tableName = process.env.TABLE_NAME ?? '';
const photosBucket = process.env.PHOTOS_BUCKET ?? '';
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});
const lambda = new LambdaClient({});
const llm = new BedrockLlmProvider();
const cars = new DynamoCarRepository(tableName, client);
const importJobs = new DynamoImportJobRepository(tableName, client);
const events = new DynamoEventRepository(tableName, client);
const adminUsers = new AwsCognitoUserAdmin(
  new CognitoIdentityProviderClient({}),
  process.env.USER_POOL_ID ?? '',
);
const metrics = new AwsCloudWatchMetrics(new CloudWatchClient({}));

const enqueueImport = async (payload: ImportWorkPayload): Promise<void> => {
  await lambda.send(new InvokeCommand({
    FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
};

// Reads the uploaded txt; null when missing or oversized (worker maps both to a failed job).
const loadS3Text = async (key: string): Promise<string | null> => {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: photosBucket, Key: key }));
    const len = res.ContentLength;
    if (len === undefined || len > IMPORT_FILE_MAX) return null;
    return (await res.Body?.transformToString('utf-8')) ?? null;
  } catch {
    return null;
  }
};

const loadScanBase64 = async (key: string): Promise<string | null> => {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: photosBucket, Key: key }));
    const len = res.ContentLength;
    if (len === undefined || len > MAX_SCAN_SIZE) return null;
    const bytes = await res.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes).toString('base64') : null;
  } catch {
    return null;
  }
};

const deps: RouteDeps = {
  cars,
  photos: new DynamoPhotoRepository(tableName, client),
  storage: new S3PhotoStorage(photosBucket, s3),
  events,
  proofs: new DynamoProofRepository(tableName, client),
  reminders: new DynamoReminderRepository(tableName, client),
  llm,
  importJobs,
  enqueueImport,
  loadScanBase64,
  newId: () => crypto.randomUUID(),
  adminUsers,
  metrics,
  apiId: process.env.API_ID ?? '',
};

const isImportPayload = (e: unknown): e is ImportWorkPayload =>
  typeof e === 'object' && e !== null && (e as { jobType?: unknown }).jobType === 'import';

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer | ImportWorkPayload,
  context: Context,
): Promise<APIGatewayProxyResultV2 | void> {
  // Detached worker invocation (async self-invoke) — no API Gateway envelope.
  if (isImportPayload(event)) {
    await runImportJob(
      { jobs: importJobs, cars, events, llm, loadS3Text, remainingMs: () => context.getRemainingTimeInMillis() },
      event,
    );
    return;
  }

  const apiEvent: ApiEvent = {
    method: event.requestContext.http.method,
    path: event.requestContext.http.path,
    ownerId: event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined ?? null,
    groups: parseGroups(event.requestContext.authorizer?.jwt?.claims?.['cognito:groups']),
    pathParams: event.pathParameters ? (event.pathParameters as Record<string, string>) : {},
    queryParams: event.queryStringParameters ? (event.queryStringParameters as Record<string, string>) : {},
    body: event.body ? JSON.parse(event.body) : null,
  };
  const result = await route(deps, apiEvent);
  return { statusCode: result.statusCode, headers: result.headers, body: result.body };
}
