import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_SIZE, MAX_PHOTOS_PER_CAR } from '@carlog/contracts';

const isAllowed = (t: string): boolean => (ALLOWED_PHOTO_TYPES as readonly string[]).includes(t);

export function validatePhotoFile(file: { type: string; size: number }, currentCount: number): string | null {
  if (currentCount >= MAX_PHOTOS_PER_CAR) return `You can add at most ${MAX_PHOTOS_PER_CAR} photos per car.`;
  if (!isAllowed(file.type)) return 'Please choose an image (JPEG, PNG, WebP, or HEIC).';
  if (file.size > MAX_PHOTO_SIZE) return 'That image is larger than 10 MB.';
  if (file.size < 1) return 'That file is empty.';
  return null;
}
