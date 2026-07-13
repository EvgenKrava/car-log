import { z } from 'zod';
import { CarSchema, type Car, type CreateCarInput } from '@carlog/contracts';

const CarListSchema = z.array(CarSchema);
const API_URL = import.meta.env.VITE_API_URL as string;

async function request<T>(token: string, path: string, schema: z.ZodTypeAny, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  if (res.status === 204) return undefined as T;
  return schema.parse(await res.json()) as T;
}

export const listCars = (token: string): Promise<Car[]> => request<Car[]>(token, '/cars', CarListSchema);
export const createCar = (token: string, input: CreateCarInput): Promise<Car> =>
  request<Car>(token, '/cars', CarSchema, { method: 'POST', body: JSON.stringify(input) });
