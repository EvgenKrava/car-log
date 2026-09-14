import type { UserDataRepository } from '@carlog/domain';

// Test double: records which owners were purged. The other in-memory repositories are
// independent maps, so a purge here does not empty them — route tests assert the call.
export class InMemoryUserDataRepository implements UserDataRepository {
  readonly purged: string[] = [];
  async deleteAllForOwner(ownerId: string): Promise<number> { this.purged.push(ownerId); return 0; }
}
