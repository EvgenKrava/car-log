import {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Photo } from '@carlog/contracts';
import { type PhotoRepository } from '@carlog/domain';

const pk = (ownerId: string) => `USER#${ownerId}`;
const sk = (carId: string, photoId: string) => `CAR#${carId}#PHOTO#${photoId}`;
const skPrefix = (carId: string) => `CAR#${carId}#PHOTO#`;

type Row = Photo & { PK: string; SK: string };
const toRow = (p: Photo): Row => ({ ...p, PK: pk(p.ownerId), SK: sk(p.carId, p.id) });
const toPhoto = (row: Record<string, unknown>): Photo => {
  const { PK, SK, ...photo } = row as Row;
  return photo;
};

export class DynamoPhotoRepository implements PhotoRepository {
  constructor(private readonly tableName: string, private readonly client: DynamoDBDocumentClient) {}

  async create(photo: Photo): Promise<Photo> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(photo) }));
    return photo;
  }

  async listByCar(ownerId: string, carId: string): Promise<Photo[]> {
    const res = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk(ownerId), ':sk': skPrefix(carId) },
    }));
    return (res.Items ?? []).map(toPhoto);
  }

  async getById(ownerId: string, carId: string, photoId: string): Promise<Photo | null> {
    const res = await this.client.send(new GetCommand({
      TableName: this.tableName, Key: { PK: pk(ownerId), SK: sk(carId, photoId) },
    }));
    return res.Item ? toPhoto(res.Item) : null;
  }

  async delete(ownerId: string, carId: string, photoId: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.tableName, Key: { PK: pk(ownerId), SK: sk(carId, photoId) },
    }));
  }
}
