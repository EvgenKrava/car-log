import { MAX_PROOFS_PER_EVENT } from '@carlog/contracts';
import { CapExceededError } from '@carlog/domain';

export const eventSk = (carId: string, eventId: string): string => `CAR#${carId}#EVENT#${eventId}`;
export const proofSk = (carId: string, eventId: string, proofId: string): string =>
  `CAR#${carId}#EVENT#${eventId}#PROOF#${proofId}`;
export const proofKey = (ownerId: string, carId: string, eventId: string, proofId: string): string =>
  `proofs/${ownerId}/${carId}/${eventId}/${proofId}`;

// An event row's SK contains "#EVENT#" but must NOT be a nested proof row.
export const isEventRow = (sk: string): boolean => sk.includes('#EVENT#') && !sk.includes('#PROOF#');

export function assertProofUnderCap(count: number): void {
  if (count >= MAX_PROOFS_PER_EVENT) throw new CapExceededError();
}
