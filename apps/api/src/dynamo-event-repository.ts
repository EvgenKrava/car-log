/* eslint-disable @typescript-eslint/no-unused-vars */
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Event, CreateEventInput } from '@carlog/contracts';
import type { EventRepository } from '@carlog/domain';

// Stub implementation — full Task 5
export class DynamoEventRepository implements EventRepository {
  constructor(private tableName: string, private client: DynamoDBDocumentClient) {}

  async create(_event: Event): Promise<Event> {
    throw new Error('DynamoEventRepository not implemented (Task 5)');
  }

  async getById(_ownerId: string, _carId: string, _eventId: string): Promise<Event | null> {
    throw new Error('DynamoEventRepository not implemented (Task 5)');
  }

  async listByCar(_ownerId: string, _carId: string): Promise<Event[]> {
    throw new Error('DynamoEventRepository not implemented (Task 5)');
  }

  async update(_ownerId: string, _carId: string, _eventId: string, _input: CreateEventInput): Promise<Event> {
    throw new Error('DynamoEventRepository not implemented (Task 5)');
  }

  async delete(_ownerId: string, _carId: string, _eventId: string): Promise<void> {
    throw new Error('DynamoEventRepository not implemented (Task 5)');
  }
}
