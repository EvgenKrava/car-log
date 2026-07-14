import { describe, expect, it } from 'vitest';
import { validatePhotoFile } from './validate-photo';
import { MAX_PHOTO_SIZE, MAX_PHOTOS_PER_CAR } from '@carlog/contracts';

describe('validatePhotoFile', () => {
  it('accepts a valid jpeg under limits', () => {
    expect(validatePhotoFile({ type: 'image/jpeg', size: 1024 }, 0)).toBeNull();
  });
  it('rejects a non-image type', () => {
    expect(validatePhotoFile({ type: 'application/pdf', size: 1024 }, 0)).toMatch(/image/i);
  });
  it('rejects a file over the size limit', () => {
    expect(validatePhotoFile({ type: 'image/png', size: MAX_PHOTO_SIZE + 1 }, 0)).toMatch(/10 ?MB|large|size/i);
  });
  it('rejects when the per-car cap is reached', () => {
    expect(validatePhotoFile({ type: 'image/png', size: 1024 }, MAX_PHOTOS_PER_CAR)).toMatch(/limit|20/i);
  });
});
