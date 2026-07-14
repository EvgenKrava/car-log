import { PresignRequestSchema, type Photo, type PresignRequest } from '@carlog/contracts';
import { newId as defaultNewId, nowIso } from './id';

export type CreatePhotoDeps = { newId?: () => string; now?: () => string };

export function createPhoto(
  ownerId: string, carId: string, input: PresignRequest, deps: CreatePhotoDeps = {},
): Photo {
  const data = PresignRequestSchema.parse(input);
  return {
    id: (deps.newId ?? defaultNewId)(),
    carId,
    ownerId,
    contentType: data.contentType,
    size: data.size,
    createdAt: (deps.now ?? nowIso)(),
  };
}

export class CapExceededError extends Error {
  constructor() {
    super('Photo limit reached for this car');
    this.name = 'CapExceededError';
  }
}

export class PhotoNotFoundError extends Error {
  constructor(id: string) {
    super(`Photo ${id} not found`);
    this.name = 'PhotoNotFoundError';
  }
}
