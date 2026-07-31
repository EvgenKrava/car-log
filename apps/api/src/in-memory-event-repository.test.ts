import { describe, expect, it } from 'vitest';
import type { Event } from '@carlog/contracts';
import { InMemoryEventRepository } from './in-memory-event-repository';

const mk = (ownerId: string, carId: string, createdAt: string): Event => ({
  id: crypto.randomUUID(),
  carId,
  ownerId,
  date: '2026-01-01',
  mileage: 1000,
  cost: 100,
  currency: 'UAH',
  category: 'oil_change',
  works: [],
  createdAt,
  updatedAt: createdAt,
});

describe('InMemoryEventRepository', () => {
  it('recentAcrossOwners returns newest-first, capped', async () => {
    const repo = new InMemoryEventRepository();
    await repo.create(mk('u1', 'c1', '2026-01-01T00:00:00.000Z'));
    await repo.create(mk('u2', 'c2', '2026-03-01T00:00:00.000Z'));
    await repo.create(mk('u1', 'c1', '2026-02-01T00:00:00.000Z'));
    const r = await repo.recentAcrossOwners(2);
    expect(r.map((e) => e.createdAt)).toEqual(['2026-03-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z']);
  });
});
