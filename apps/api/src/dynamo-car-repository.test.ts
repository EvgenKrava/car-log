import { describe, expect, it } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Car } from '@carlog/contracts';
import { DynamoCarRepository } from './dynamo-car-repository';

// Minimal fake: capture each command's input so we can assert the persisted item shape,
// and optionally serve a canned GetCommand response for read-boundary tests.
function fakeClient(getResult?: Record<string, unknown>) {
  const inputs: Array<Record<string, unknown>> = [];
  const client = {
    send: async (cmd: { input: Record<string, unknown>; constructor: { name: string } }) => {
      inputs.push(cmd.input);
      if (cmd.constructor.name === 'GetCommand') return { Item: getResult };
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
  return { client, inputs };
}

const car: Car = {
  id: 'c1', ownerId: 'u1', make: 'VW', model: 'Golf', year: 2018, mileage: 90000,
  fuelType: 'diesel', engineVolume: undefined, nickname: undefined, vin: undefined,
  licensePlate: undefined, createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z', mileageUpdatedAt: '2024-01-01T00:00:00.000Z', shared: false,
};

describe('DynamoCarRepository', () => {
  it('reads back a legacy row (no mileageUpdatedAt) with mileageUpdatedAt backfilled from updatedAt', async () => {
    // Simulates a row written before mileageUpdatedAt existed — the stored item has no
    // mileageUpdatedAt key at all.
    const legacyRow = {
      PK: 'USER#u1', SK: 'CAR#c1',
      id: 'c1', ownerId: 'u1', make: 'VW', model: 'Golf', year: 2018, mileage: 90000,
      fuelType: 'diesel', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-06-01T00:00:00.000Z',
      shared: false,
    };
    const { client } = fakeClient(legacyRow);
    const repo = new DynamoCarRepository('tbl', client);
    const result = await repo.getById('u1', 'c1');
    expect(result?.mileageUpdatedAt).toBe('2024-06-01T00:00:00.000Z');
  });

  it('update() persists a given mileageUpdatedAt verbatim', async () => {
    const { client, inputs } = fakeClient(car);
    const repo = new DynamoCarRepository('tbl', client);
    const input = { make: car.make, model: car.model, year: car.year, mileage: 95000, fuelType: car.fuelType };
    const updated = await repo.update('u1', 'c1', input, '2026-08-07T00:00:00.000Z');
    expect(updated.mileageUpdatedAt).toBe('2026-08-07T00:00:00.000Z');
    const putInput = inputs.find((i) => 'Item' in i);
    expect((putInput!.Item as Car).mileageUpdatedAt).toBe('2026-08-07T00:00:00.000Z');
  });

  it('update() keeps the stored mileageUpdatedAt when the argument is absent', async () => {
    const { client } = fakeClient(car);
    const repo = new DynamoCarRepository('tbl', client);
    const input = { make: car.make, model: car.model, year: car.year, mileage: car.mileage, fuelType: car.fuelType };
    const updated = await repo.update('u1', 'c1', input);
    expect(updated.mileageUpdatedAt).toBe(car.mileageUpdatedAt);
  });
});
