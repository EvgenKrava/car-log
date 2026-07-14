import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { Proof } from '@carlog/contracts';
import { type ProofRepository } from '@carlog/domain';
import { proofSk } from './event-key';

const pk = (ownerId: string) => `USER#${ownerId}`;
type Row = Proof & { PK: string; SK: string };
const toRow = (p: Proof): Row => ({ ...p, PK: pk(p.ownerId), SK: proofSk(p.carId, p.eventId, p.id) });
const toProof = (row: Record<string, unknown>): Proof => {
  const { PK, SK, ...proof } = row as Row;
  return proof;
};

export class DynamoProofRepository implements ProofRepository {
  constructor(private readonly tableName: string, private readonly client: DynamoDBDocumentClient) {}

  async create(proof: Proof): Promise<Proof> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(proof) }));
    return proof;
  }
  async listByEvent(ownerId: string, carId: string, eventId: string): Promise<Proof[]> {
    const res = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk(ownerId), ':sk': `CAR#${carId}#EVENT#${eventId}#PROOF#` },
    }));
    return (res.Items ?? []).map(toProof);
  }
  async getById(ownerId: string, carId: string, eventId: string, proofId: string): Promise<Proof | null> {
    const res = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { PK: pk(ownerId), SK: proofSk(carId, eventId, proofId) } }));
    return res.Item ? toProof(res.Item) : null;
  }
  async delete(ownerId: string, carId: string, eventId: string, proofId: string): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { PK: pk(ownerId), SK: proofSk(carId, eventId, proofId) } }));
  }
}
