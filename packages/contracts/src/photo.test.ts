import { describe, expect, it } from 'vitest';
import { PresignRequestSchema, PhotoSchema, MAX_PHOTO_SIZE } from './photo';

describe('PresignRequestSchema', () => {
  it('accepts a valid image request', () => {
    expect(PresignRequestSchema.parse({ contentType: 'image/jpeg', size: 1024 }))
      .toEqual({ contentType: 'image/jpeg', size: 1024 });
  });
  it('rejects a non-image content type', () => {
    expect(() => PresignRequestSchema.parse({ contentType: 'application/pdf', size: 1024 })).toThrow();
  });
  it('rejects a size over the max', () => {
    expect(() => PresignRequestSchema.parse({ contentType: 'image/png', size: MAX_PHOTO_SIZE + 1 })).toThrow();
  });
  it('rejects a zero/negative size', () => {
    expect(() => PresignRequestSchema.parse({ contentType: 'image/png', size: 0 })).toThrow();
  });
});

describe('PhotoSchema', () => {
  it('requires id/carId/ownerId/contentType/size/createdAt', () => {
    expect(() => PhotoSchema.parse({ contentType: 'image/png', size: 10 })).toThrow();
  });
});
