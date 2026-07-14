import type { Photo } from '@carlog/contracts';
import { type PhotoRepository } from '@carlog/domain';

export class InMemoryPhotoRepository implements PhotoRepository {
  private photos = new Map<string, Photo>();
  private key(ownerId: string, carId: string, photoId: string) { return `${ownerId}#${carId}#${photoId}`; }

  async create(photo: Photo): Promise<Photo> {
    this.photos.set(this.key(photo.ownerId, photo.carId, photo.id), photo);
    return photo;
  }
  async listByCar(ownerId: string, carId: string): Promise<Photo[]> {
    return [...this.photos.values()].filter((p) => p.ownerId === ownerId && p.carId === carId);
  }
  async getById(ownerId: string, carId: string, photoId: string): Promise<Photo | null> {
    return this.photos.get(this.key(ownerId, carId, photoId)) ?? null;
  }
  async delete(ownerId: string, carId: string, photoId: string): Promise<void> {
    this.photos.delete(this.key(ownerId, carId, photoId));
  }
}
