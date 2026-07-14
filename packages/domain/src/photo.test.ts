import { describe, expect, it } from 'vitest';
import { createPhoto } from './photo';

const deps = { newId: () => 'photo-id', now: () => '2026-07-14T00:00:00.000Z' };

describe('createPhoto', () => {
  it('assigns id/ownerId/carId/timestamps from a valid presign request', () => {
    const p = createPhoto('u1', '11111111-1111-1111-1111-111111111111',
      { contentType: 'image/jpeg', size: 2048 }, deps);
    expect(p).toMatchObject({
      id: 'photo-id', ownerId: 'u1', carId: '11111111-1111-1111-1111-111111111111',
      contentType: 'image/jpeg', size: 2048, createdAt: '2026-07-14T00:00:00.000Z',
    });
  });
  it('rejects an invalid content type', () => {
    expect(() => createPhoto('u1', '11111111-1111-1111-1111-111111111111',
      // @ts-expect-error invalid content type on purpose
      { contentType: 'application/pdf', size: 10 }, deps)).toThrow();
  });
});
