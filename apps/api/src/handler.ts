import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2,
} from 'aws-lambda';
import { DynamoCarRepository } from './dynamo-car-repository';
import { route, type ApiEvent } from './router';

const tableName = process.env.TABLE_NAME ?? '';
// removeUndefinedValues: optional car fields (nickname/vin/licensePlate) are `undefined`
// when omitted or submitted blank; without this the marshaller throws on PutCommand.
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const repo = new DynamoCarRepository(tableName, client);

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
  const result = await route(repo, apiEvent);
  return { statusCode: result.statusCode, headers: result.headers, body: result.body };
}
