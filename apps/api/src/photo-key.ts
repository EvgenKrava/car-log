import { MAX_PHOTOS_PER_CAR } from '@carlog/contracts';
import { CapExceededError } from '@carlog/domain';

export const photoKey = (ownerId: string, carId: string, photoId: string): string =>
  `photos/${ownerId}/${carId}/${photoId}`;

export function assertUnderCap(count: number): void {
  if (count >= MAX_PHOTOS_PER_CAR) throw new CapExceededError();
}
