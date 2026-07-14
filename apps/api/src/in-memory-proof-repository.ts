import type { Proof } from '@carlog/contracts';
import { type ProofRepository } from '@carlog/domain';

export class InMemoryProofRepository implements ProofRepository {
  private proofs = new Map<string, Proof>();
  private k(o: string, c: string, e: string, p: string) { return `${o}#${c}#${e}#${p}`; }

  async create(proof: Proof): Promise<Proof> {
    this.proofs.set(this.k(proof.ownerId, proof.carId, proof.eventId, proof.id), proof);
    return proof;
  }
  async listByEvent(ownerId: string, carId: string, eventId: string): Promise<Proof[]> {
    return [...this.proofs.values()].filter((p) => p.ownerId === ownerId && p.carId === carId && p.eventId === eventId);
  }
  async getById(ownerId: string, carId: string, eventId: string, proofId: string): Promise<Proof | null> {
    return this.proofs.get(this.k(ownerId, carId, eventId, proofId)) ?? null;
  }
  async delete(ownerId: string, carId: string, eventId: string, proofId: string): Promise<void> {
    this.proofs.delete(this.k(ownerId, carId, eventId, proofId));
  }
}
