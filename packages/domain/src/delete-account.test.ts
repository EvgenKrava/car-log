import { describe, expect, it, vi } from 'vitest';
import type { Car } from '@carlog/contracts';
import { deleteAccount, OWNER_PREFIXES, type DeleteAccountDeps } from './delete-account';
import { createCar } from './car';

function deps(cars: Car[]) {
  const calls: string[] = [];
  const d: DeleteAccountDeps = {
    cars: {
      listByOwner: async () => cars,
      setShared: vi.fn(async (_o: string, id: string, shared: boolean) => { calls.push(`unshare:${id}:${shared}`); return cars[0]; }),
    } as unknown as DeleteAccountDeps['cars'],
    storage: { deletePrefix: vi.fn(async (p: string) => { calls.push(`s3:${p}`); return 1; }) } as unknown as DeleteAccountDeps['storage'],
    userData: { deleteAllForOwner: vi.fn(async (o: string) => { calls.push(`rows:${o}`); return 3; }) },
    identity: { deleteUser: vi.fn(async (u: string) => { calls.push(`cognito:${u}`); }) },
  };
  return { d, calls };
}

describe('deleteAccount', () => {
  it('unshares shared cars, purges S3 prefixes and rows, then deletes the identity — in that order', async () => {
    const shared = { ...createCar('u1', { make: 'VW', model: 'Golf', year: 2018, mileage: 1, fuelType: 'diesel' }), shared: true };
    const plain = createCar('u1', { make: 'VW', model: 'Polo', year: 2019, mileage: 1, fuelType: 'petrol' });
    const { d, calls } = deps([shared, plain]);
    await deleteAccount(d, 'u1', 'user-1');
    expect(calls).toEqual([
      `unshare:${shared.id}:false`,
      ...OWNER_PREFIXES.map((p) => `s3:${p}u1/`),
      'rows:u1',
      'cognito:user-1',
    ]);
  });

  it('does not touch the identity when the row purge fails (retryable)', async () => {
    const { d, calls } = deps([]);
    d.userData.deleteAllForOwner = async () => { throw new Error('dynamo down'); };
    await expect(deleteAccount(d, 'u1', 'user-1')).rejects.toThrow('dynamo down');
    expect(calls.some((c) => c.startsWith('cognito:'))).toBe(false);
  });
});
