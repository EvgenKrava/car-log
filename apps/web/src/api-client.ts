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
  EventSchema,
  type Event,
  type CreateEventInput,
  ProofWithUrlSchema,
  ProofSchema,
  ProofPresignResponseSchema,
  type ProofWithUrl,
  type ProofPresignResponse,
  type AttachmentContentType,
  ExtractEventsResponseSchema,
  type ExtractEventsResponse,
  ImportJobSchema,
  type ImportJob,
} from '@carlog/contracts';

const CarListSchema = z.array(CarSchema);
const PhotoListSchema = z.array(PhotoWithUrlSchema);
const EventListSchema = z.array(EventSchema);
const ProofListSchema = z.array(ProofWithUrlSchema);
const API_URL = import.meta.env.VITE_API_URL as string;

// Bind the generic to the schema's OUTPUT type (post-parse). Schemas that use
// `.default()` (e.g. Event.currency/works) have a looser INPUT type where those
// fields are optional; `.parse()` returns the output where they are present, so
// callers get the correct required-field types.
async function request<S extends z.ZodTypeAny>(
  token: string, path: string, schema: S, init?: RequestInit,
): Promise<z.output<S>> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  if (res.status === 204) return undefined as z.output<S>;
  return schema.parse(await res.json()) as z.output<S>;
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

export const getEvents = (token: string, carId: string): Promise<Event[]> =>
  request(token, `/cars/${carId}/events`, EventListSchema);
export const createEvent = (token: string, carId: string, input: CreateEventInput): Promise<Event> =>
  request(token, `/cars/${carId}/events`, EventSchema, { method: 'POST', body: JSON.stringify(input) });
export const updateEvent = (token: string, carId: string, eventId: string, input: CreateEventInput): Promise<Event> =>
  request(token, `/cars/${carId}/events/${eventId}`, EventSchema, { method: 'PUT', body: JSON.stringify(input) });
export const deleteEvent = (token: string, carId: string, eventId: string): Promise<void> =>
  request(token, `/cars/${carId}/events/${eventId}`, EventSchema, { method: 'DELETE' }).then(() => undefined);

const proofBase = (carId: string, eventId: string) => `/cars/${carId}/events/${eventId}/proofs`;
export const presignProof = (token: string, carId: string, eventId: string, input: { contentType: AttachmentContentType; size: number; filename?: string }): Promise<ProofPresignResponse> =>
  request(token, `${proofBase(carId, eventId)}/presign`, ProofPresignResponseSchema, { method: 'POST', body: JSON.stringify(input) });
export const confirmProof = (token: string, carId: string, eventId: string, input: { proofId: string; contentType: AttachmentContentType; size: number; filename?: string }) =>
  request(token, proofBase(carId, eventId), ProofSchema, { method: 'POST', body: JSON.stringify(input) });
export const listProofs = (token: string, carId: string, eventId: string): Promise<ProofWithUrl[]> =>
  request(token, proofBase(carId, eventId), ProofListSchema);
export const deleteProof = (token: string, carId: string, eventId: string, proofId: string): Promise<void> =>
  request(token, `${proofBase(carId, eventId)}/${proofId}`, ProofSchema, { method: 'DELETE' }).then(() => undefined);

export async function uploadProof(token: string, carId: string, eventId: string, file: File): Promise<void> {
  const input = { contentType: file.type as AttachmentContentType, size: file.size, filename: file.name };
  const { uploadUrl, proofId } = await presignProof(token, carId, eventId, input);
  await uploadToS3(uploadUrl, file);
  await confirmProof(token, carId, eventId, { ...input, proofId });
}

export const extractEvents = (token: string, carId: string, text: string): Promise<ExtractEventsResponse> =>
  request(token, '/import/extract', ExtractEventsResponseSchema, { method: 'POST', body: JSON.stringify({ carId, text }) });

const ImportPresignSchema = z.object({ key: z.string(), uploadUrl: z.string().url() });
const CreateJobResponseSchema = z.object({ jobId: z.string().uuid() });

export const presignImportTxt = (token: string, size: number): Promise<z.infer<typeof ImportPresignSchema>> =>
  request(token, '/import/presign', ImportPresignSchema, { method: 'POST', body: JSON.stringify({ size }) });

export const createImportJob = (token: string, input: { carId: string; text?: string; s3Key?: string }): Promise<{ jobId: string }> =>
  request(token, '/import/jobs', CreateJobResponseSchema, { method: 'POST', body: JSON.stringify(input) });

export const getImportJob = (token: string, carId: string, jobId: string): Promise<ImportJob> =>
  request(token, `/import/jobs/${jobId}?carId=${encodeURIComponent(carId)}`, ImportJobSchema);

// Dismiss a finished import job so reopening bulk import starts clean instead of re-adopting
// the same completed job (and re-seeding already-committed events). Idempotent server-side.
export const deleteImportJob = (token: string, carId: string, jobId: string): Promise<void> =>
  request(token, `/import/jobs/${jobId}?carId=${encodeURIComponent(carId)}`, ImportJobSchema, { method: 'DELETE' })
    .then(() => undefined);

export const latestImportJob = async (token: string, carId: string): Promise<ImportJob | null> => {
  try {
    return await request(token, `/import/jobs?carId=${encodeURIComponent(carId)}`, ImportJobSchema);
  } catch (e) {
    if ((e as Error).message.includes('404')) return null;
    throw e;
  }
};

const ScanPresignSchema = z.object({ key: z.string(), uploadUrl: z.string().url() });
export const presignScan = (token: string, contentType: string, size: number): Promise<z.infer<typeof ScanPresignSchema>> =>
  request(token, '/import/scan/presign', ScanPresignSchema, { method: 'POST', body: JSON.stringify({ contentType, size }) });
export const extractFromScan = (token: string, carId: string, s3Key: string, contentType: string): Promise<ExtractEventsResponse> =>
  request(token, '/import/scan', ExtractEventsResponseSchema, { method: 'POST', body: JSON.stringify({ carId, s3Key, contentType }) });
export const confirmProofFromScan = (token: string, carId: string, eventId: string, s3Key: string, contentType: string, size: number) =>
  request(token, `/cars/${carId}/events/${eventId}/proofs/from-scan`, ProofSchema, { method: 'POST', body: JSON.stringify({ s3Key, contentType, size }) });
