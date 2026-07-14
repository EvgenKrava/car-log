import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2,
} from 'aws-lambda';
import { DynamoCarRepository } from './dynamo-car-repository';
import { route, type ApiEvent, type RouteDeps } from './router';
import { InMemoryPhotoRepository } from './in-memory-photo-repository';
import type { PhotoStorage } from '@carlog/domain';

const tableName = process.env.TABLE_NAME ?? '';
// removeUndefinedValues: optional car fields (nickname/vin/licensePlate) are `undefined`
// when omitted or submitted blank; without this the marshaller throws on PutCommand.
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const repo = new DynamoCarRepository(tableName, client);

// TODO Task 5: replace with real S3PhotoStorage + DynamoPhotoRepository
const photoStorage: PhotoStorage = {
  presignPut: async () => { throw new Error('Photo storage not yet configured'); },
  presignGet: async () => { throw new Error('Photo storage not yet configured'); },
  deleteObject: async () => { throw new Error('Photo storage not yet configured'); },
};
const deps: RouteDeps = { cars: repo, photos: new InMemoryPhotoRepository(), storage: photoStorage };

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
