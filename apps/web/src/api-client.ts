import { z } from 'zod';
import {
  CarSchema,
  type Car,
  type CreateCarInput,
  PhotoWithUrlSchema,
  PhotoSchema,
  PresignResponseSchema,
  type PhotoWithUrl,
  type PresignResponse,
  type PhotoContentType,
} from '@carlog/contracts';

const CarListSchema = z.array(CarSchema);
const PhotoListSchema = z.array(PhotoWithUrlSchema);
const API_URL = import.meta.env.VITE_API_URL as string;

async function request<T>(token: string, path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  if (res.status === 204) return undefined as T;
  return schema.parse(await res.json());
}

export const listCars = (token: string): Promise<Car[]> => request(token, '/cars', CarListSchema);
export const createCar = (token: string, input: CreateCarInput): Promise<Car> =>
  request(token, '/cars', CarSchema, { method: 'POST', body: JSON.stringify(input) });

export const getCar = (token: string, id: string): Promise<Car> =>
  request(token, `/cars/${id}`, CarSchema);

export const updateCar = (token: string, id: string, input: CreateCarInput): Promise<Car> =>
  request(token, `/cars/${id}`, CarSchema, { method: 'PUT', body: JSON.stringify(input) });

export const deleteCar = (token: string, id: string): Promise<void> =>
  request(token, `/cars/${id}`, CarSchema, { method: 'DELETE' }).then(() => undefined);

export const presignPhoto = (token: string, carId: string, input: { contentType: PhotoContentType; size: number }): Promise<PresignResponse> =>
  request(token, `/cars/${carId}/photos/presign`, PresignResponseSchema, { method: 'POST', body: JSON.stringify(input) });

export async function uploadToS3(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!res.ok) throw new Error(`S3 upload ${res.status}`);
}

export const confirmPhoto = (token: string, carId: string, input: { photoId: string; contentType: PhotoContentType; size: number }) =>
  request(token, `/cars/${carId}/photos`, PhotoSchema, { method: 'POST', body: JSON.stringify(input) });

export const listPhotos = (token: string, carId: string): Promise<PhotoWithUrl[]> =>
  request(token, `/cars/${carId}/photos`, PhotoListSchema);

export const deletePhoto = (token: string, carId: string, photoId: string): Promise<void> =>
  request(token, `/cars/${carId}/photos/${photoId}`, PhotoSchema, { method: 'DELETE' }).then(() => undefined);

export async function uploadPhoto(token: string, carId: string, file: File): Promise<void> {
  const input = { contentType: file.type as PhotoContentType, size: file.size };
  const { uploadUrl, photoId } = await presignPhoto(token, carId, input);
  await uploadToS3(uploadUrl, file);
  await confirmPhoto(token, carId, { ...input, photoId });
}
