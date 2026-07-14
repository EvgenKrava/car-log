import { describe, expect, it } from 'vitest';
import { validatePhotoFile } from './validate-photo';
import { MAX_PHOTO_SIZE, MAX_PHOTOS_PER_CAR } from '@carlog/contracts';

describe('validatePhotoFile', () => {
  it('accepts a valid jpeg under limits', () => {
    expect(validatePhotoFile({ type: 'image/jpeg', size: 1024 }, 0)).toBeNull();
  });
  it('rejects a non-image type', () => {
    expect(validatePhotoFile({ type: 'application/pdf', size: 1024 }, 0)).toEqual({ key: 'photos:notImage' });
  });
  it('rejects a file over the size limit', () => {
    expect(validatePhotoFile({ type: 'image/png', size: MAX_PHOTO_SIZE + 1 }, 0)).toEqual({ key: 'photos:tooLarge' });
  });
  it('rejects when the per-car cap is reached', () => {
    expect(validatePhotoFile({ type: 'image/png', size: 1024 }, MAX_PHOTOS_PER_CAR)).toEqual({
      key: 'photos:tooMany',
      params: { max: MAX_PHOTOS_PER_CAR },
    });
  });
  it('rejects an empty file', () => {
    expect(validatePhotoFile({ type: 'image/png', size: 0 }, 0)).toEqual({ key: 'photos:empty0' });
  });
});
