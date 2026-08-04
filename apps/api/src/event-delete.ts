import type { EventRepository, ProofRepository, PhotoStorage } from '@carlog/domain';
import { proofKey } from './event-key';

export type EventDeleteDeps = {
  events: EventRepository; proofs: ProofRepository; storage: PhotoStorage;
};

// Delete an event and its proofs. Proof objects + rows go FIRST, so an interrupted delete
// never leaves proof rows under a missing event, and the whole op is safe to retry (S3
// DeleteObject is idempotent). Narrow window: if proofs.delete throws after a successful
// deleteObject, that one S3 object is orphaned; a retry of the whole delete cleans it up.
// Shared by DELETE /cars/{id}/events/{eventId} and the chat delete-confirmation route.
export async function deleteEventCascade(
  deps: EventDeleteDeps, ownerId: string, carId: string, eventId: string,
): Promise<void> {
  const proofs = await deps.proofs.listByEvent(ownerId, carId, eventId);
  for (const p of proofs) {
    await deps.storage.deleteObject(proofKey(ownerId, carId, eventId, p.id));
    await deps.proofs.delete(ownerId, carId, eventId, p.id);
  }
  await deps.events.delete(ownerId, carId, eventId);
}
