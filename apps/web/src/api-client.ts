import { z } from 'zod';
import { CarSchema, type Car, type CreateCarInput, type UpdateCarInput } from '@carlog/contracts';

const CarListSchema = z.array(CarSchema);
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

export const updateCar = (token: string, id: string, input: UpdateCarInput): Promise<Car> =>
  request(token, `/cars/${id}`, CarSchema, { method: 'PUT', body: JSON.stringify(input) });

export const deleteCar = (token: string, id: string): Promise<void> =>
  request(token, `/cars/${id}`, CarSchema, { method: 'DELETE' }).then(() => undefined);
