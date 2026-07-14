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
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk(ownerId), ':sk': 'CAR#' },
    }));
    // begins_with(SK, "CAR#") also matches nested rows: photos (CAR#<id>#PHOTO#<pid>),
    // events (CAR#<id>#EVENT#<eid>), proofs, etc. FilterExpression can't reference the SK
    // key attribute, so filter in code. Whitelist the car row shape rather than blacklist
    // each nested type: a car SK is exactly "CAR#<carId>" — two "#"-segments, no more.
    // This stays collision-proof as new nested entities are added.
    const isCarRow = (sk: string): boolean => sk.split('#').length === 2 && sk.startsWith('CAR#');
    return (res.Items ?? [])
      .filter((item) => isCarRow(String((item as Row).SK)))
      .map(toCar);
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
