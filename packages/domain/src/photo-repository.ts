import type { Photo } from '@carlog/contracts';

export interface PhotoRepository {
  create(photo: Photo): Promise<Photo>;
  listByCar(ownerId: string, carId: string): Promise<Photo[]>;
  getById(ownerId: string, carId: string, photoId: string): Promise<Photo | null>;
  delete(ownerId: string, carId: string, photoId: string): Promise<void>;
}

export interface PhotoStorage {
  presignPut(key: string, contentType: string, maxSize: number): Promise<string>;
  presignGet(key: string): Promise<string>;
  deleteObject(key: string): Promise<void>;
}
