/* eslint-disable @typescript-eslint/no-unused-vars */
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Proof } from '@carlog/contracts';
import type { ProofRepository } from '@carlog/domain';

// Stub implementation — full Task 5
export class DynamoProofRepository implements ProofRepository {
  constructor(private tableName: string, private client: DynamoDBDocumentClient) {}

  async create(_proof: Proof): Promise<Proof> {
    throw new Error('DynamoProofRepository not implemented (Task 5)');
  }

  async getById(_ownerId: string, _carId: string, _eventId: string, _proofId: string): Promise<Proof | null> {
    throw new Error('DynamoProofRepository not implemented (Task 5)');
  }

  async listByEvent(_ownerId: string, _carId: string, _eventId: string): Promise<Proof[]> {
    throw new Error('DynamoProofRepository not implemented (Task 5)');
  }

  async delete(_ownerId: string, _carId: string, _eventId: string, _proofId: string): Promise<void> {
    throw new Error('DynamoProofRepository not implemented (Task 5)');
  }
}
