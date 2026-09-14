import type { CarRepository } from './car-repository';
import type { PhotoStorage } from './storage';
import type { IdentityDeleter, UserDataRepository } from './user-data-repository';

export type DeleteAccountDeps = {
  cars: CarRepository; storage: PhotoStorage; userData: UserDataRepository; identity: IdentityDeleter;
};

// Every S3 prefix that holds owner-scoped objects. Keys are `<prefix><ownerId>/...`.
export const OWNER_PREFIXES = ['proofs/', 'scans/', 'imports/', 'chat/'] as const;

// Order matters: data first, identity last, so a mid-way failure leaves the user able
// to sign in and retry. SHARE#<carId> rows live outside the owner partition, hence the
// explicit unshare before the partition sweep.
export async function deleteAccount(deps: DeleteAccountDeps, ownerId: string, username: string): Promise<void> {
  const cars = await deps.cars.listByOwner(ownerId);
  for (const car of cars) {
    if (car.shared) await deps.cars.setShared(ownerId, car.id, false);
  }
  for (const prefix of OWNER_PREFIXES) await deps.storage.deletePrefix(`${prefix}${ownerId}/`);
  await deps.userData.deleteAllForOwner(ownerId);
  await deps.identity.deleteUser(username);
}
