import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_SIZE, MAX_PHOTOS_PER_CAR } from '@carlog/contracts';

const isAllowed = (t: string): boolean => (ALLOWED_PHOTO_TYPES as readonly string[]).includes(t);

export function validatePhotoFile(
  file: { type: string; size: number },
  currentCount: number
): { key: string; params?: Record<string, unknown> } | null {
  if (currentCount >= MAX_PHOTOS_PER_CAR) return { key: 'photos:tooMany', params: { max: MAX_PHOTOS_PER_CAR } };
  if (!isAllowed(file.type)) return { key: 'photos:notImage' };
  if (file.size > MAX_PHOTO_SIZE) return { key: 'photos:tooLarge' };
  if (file.size < 1) return { key: 'photos:empty0' };
  return null;
}
