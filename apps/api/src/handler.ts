import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2,
} from 'aws-lambda';
import { DynamoCarRepository } from './dynamo-car-repository';
import { DynamoPhotoRepository } from './dynamo-photo-repository';
import { DynamoEventRepository } from './dynamo-event-repository';
import { DynamoProofRepository } from './dynamo-proof-repository';
import { S3PhotoStorage } from './s3-photo-storage';
import { route, type ApiEvent, type RouteDeps } from './router';

const tableName = process.env.TABLE_NAME ?? '';
const photosBucket = process.env.PHOTOS_BUCKET ?? '';
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const deps: RouteDeps = {
  cars: new DynamoCarRepository(tableName, client),
  photos: new DynamoPhotoRepository(tableName, client),
  storage: new S3PhotoStorage(photosBucket, new S3Client({})),
  events: new DynamoEventRepository(tableName, client),
  proofs: new DynamoProofRepository(tableName, client),
};

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const apiEvent: ApiEvent = {
    method: event.requestContext.http.method,
    path: event.requestContext.http.path,
    ownerId: event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined ?? null,
    pathParams: event.pathParameters ? (event.pathParameters as Record<string, string>) : {},
    body: event.body ? JSON.parse(event.body) : null,
  };
  const result = await route(deps, apiEvent);
  return { statusCode: result.statusCode, headers: result.headers, body: result.body };
}
