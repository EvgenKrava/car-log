import type { Proof } from '@carlog/contracts';

export interface ProofRepository {
  create(proof: Proof): Promise<Proof>;
  listByEvent(ownerId: string, carId: string, eventId: string): Promise<Proof[]>;
  getById(ownerId: string, carId: string, eventId: string, proofId: string): Promise<Proof | null>;
  delete(ownerId: string, carId: string, eventId: string, proofId: string): Promise<void>;
}
