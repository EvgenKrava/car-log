import {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Car, CreateCarInput } from '@carlog/contracts';
import { CarNotFoundError, type CarRepository } from '@carlog/domain';

const pk = (ownerId: string) => `USER#${ownerId}`;
const sk = (id: string) => `CAR#${id}`;

type Row = Car & { PK: string; SK: string };
const toRow = (car: Car): Row => ({ ...car, PK: pk(car.ownerId), SK: sk(car.id) });
const toCar = (row: Record<string, unknown>): Car => {
  const { PK, SK, ...car } = row as Row;
  return car;
};

export class DynamoCarRepository implements CarRepository {
  constructor(private readonly tableName: string, private readonly client: DynamoDBDocumentClient) {}

  async create(car: Car): Promise<Car> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(car) }));
    return car;
  }

  async listByOwner(ownerId: string): Promise<Car[]> {
    const res = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      // begins_with(SK, "CAR#") also matches photo rows (SK = CAR#<id>#PHOTO#<photoId>),
      // so exclude any SK containing a nested "#PHOTO#" segment — leaving only car rows.
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: 'NOT contains(SK, :photoMarker)',
      ExpressionAttributeValues: { ':pk': pk(ownerId), ':sk': 'CAR#', ':photoMarker': '#PHOTO#' },
    }));
    return (res.Items ?? []).map(toCar);
  }

  async getById(ownerId: string, id: string): Promise<Car | null> {
    const res = await this.client.send(new GetCommand({
      TableName: this.tableName, Key: { PK: pk(ownerId), SK: sk(id) },
    }));
    return res.Item ? toCar(res.Item) : null;
  }

  async update(ownerId: string, id: string, input: CreateCarInput): Promise<Car> {
    const existing = await this.getById(ownerId, id);
    if (!existing) throw new CarNotFoundError(id);
    const updated: Car = {
      ...input,
      id: existing.id,
      ownerId: existing.ownerId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(updated) }));
    return updated;
  }

  async delete(ownerId: string, id: string): Promise<void> {
    const existing = await this.getById(ownerId, id);
    if (!existing) throw new CarNotFoundError(id);
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { PK: pk(ownerId), SK: sk(id) } }));
  }
}
