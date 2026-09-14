import type { PresignedUpload } from '@carlog/contracts';

// Object-storage port for car-scoped binary assets (scan uploads, event proofs).
// Named `PhotoStorage` for historical reasons; it is not photo-specific.
export interface PhotoStorage {
  // Presigned browser POST bounded to [1, maxSize] bytes and the given content type.
  presignUpload(key: string, contentType: string, maxSize: number): Promise<PresignedUpload>;
  presignGet(key: string): Promise<string>;
  deleteObject(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  copyObject(srcKey: string, destKey: string): Promise<void>;
  // Deletes every object under `prefix`; returns the count.
  deletePrefix(prefix: string): Promise<number>;
}

// Thrown by the per-car / per-event cap guards (proofs, reminders) when a
// collection is already at its maximum size.
export class CapExceededError extends Error {
  constructor(message = 'Collection limit reached') {
    super(message);
    this.name = 'CapExceededError';
  }
}