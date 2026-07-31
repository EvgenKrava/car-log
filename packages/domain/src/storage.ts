// Object-storage port for car-scoped binary assets (scan uploads, event proofs).
// Named `PhotoStorage` for historical reasons; it is not photo-specific.
export interface PhotoStorage {
  presignPut(key: string, contentType: string, maxSize: number): Promise<string>;
  presignGet(key: string): Promise<string>;
  deleteObject(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  copyObject(srcKey: string, destKey: string): Promise<void>;
}

// Thrown by the per-car / per-event cap guards (proofs, reminders) when a
// collection is already at its maximum size.
export class CapExceededError extends Error {
  constructor(message = 'Collection limit reached') {
    super(message);
    this.name = 'CapExceededError';
  }
}